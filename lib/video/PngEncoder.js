// Converts a video stream into a stream of png buffers. Each 'data' event
// is guaranteed to contain exactly 1 png image.

// @TODO handle ffmpeg/avconv exit (and trigger "error" if unexpected)

var Stream      = require('stream').Stream;
var util        = require('util');
var spawn       = require('child_process').spawn;
var PngSplitter = require('./PngSplitter');

module.exports = PngEncoder;
util.inherits(PngEncoder, Stream);
function PngEncoder(options) {
  Stream.call(this);

  options = options || {};

  this.writable = true;
  this.readable = true;

  this._spawn         = options.spawn || spawn;
  this._imageSize     = options.imageSize || null;
  this._frameRate     = options.frameRate || 5;
  this._pngSplitter   = options.pngSplitter || new PngSplitter();
  this._log           = options.log;
  this._converterPath = options.converterPath || "ffmpeg";
  this._converter     = undefined;
  this._ending        = false;
}

PngEncoder.prototype.write = function(buffer) {
  if (!this._converter) {
    this._initConverterAndPipes();
  }

  return this._converter.stdin.write(buffer);
};

PngEncoder.prototype._initConverterAndPipes = function() {
  this._converter = this._spawnConverter();

  // @TODO: Make this more sophisticated for somehow and figure out how it
  // will work with the planned new data recording system.
  if (this._log) {
    this._converter.stderr.pipe(this._log);
  }

  this._converter.stdout.pipe(this._pngSplitter);
  this._pngSplitter.on('data', this.emit.bind(this, 'data'));

  // 'error' can be EPIPE if converter does not exist. We handle this with the
  // 'exit' event below.
  this._converter.stdin.on('error', function() {});

  this._converter.stdin.on('drain', this.emit.bind(this, 'drain'));

  var self = this;
  // Since node 0.10, spawn emits 'error' when the child can't be spawned.
  // http://nodejs.org/api/child_process.html#child_process_event_error
  this._converter.on('error', function(err) {
    if (err.code === 'ENOENT') {
      self.emit('error', new Error('Converter "' + this.converterPath + '" was not found.'));
    } else {
      self.emit('error', new Error('Unexpected error when launching converter:' + err.toString()));
    }
  });

  this._converter.on('exit', function(code) {
    if (code === 0) {
      // we expected converter to exit
      if (self._ending) {
        self.emit('end');
        return;
      }

      self.emit('error', new Error('Unexpected converter exit with code 0.'));
      return;
    }

    // 127 is used by the OS to indicate that converter was not found
    // required when using node < 0.10
    if (code === 127) {
      self.emit('error', new Error('Converter "' + this._converterPath + '" was not found / exit code 127.'));
      return;
    }

    self.emit('error', new Error('Converter exited with error code: ' + code));
  });
};

PngEncoder.prototype._spawnConverter = function() {
  var converterOptions = [];
  converterOptions.push('-i', '-'); // input flag
  converterOptions.push('-f', 'image2pipe'); // format flag
  if(this._imageSize){
    converterOptions.push('-s', this._imageSize); // size flag
  }
  converterOptions.push('-vcodec', 'png'); // codec flag
  converterOptions.push('-r', this._frameRate); // framerate flag
  converterOptions.push('-'); // output
  return this._spawn(this._converterPath, converterOptions);
};

PngEncoder.prototype.end = function() {
  // No data handled yet? Nothing to do for ending.
  if (!this._converter) {
    return;
  }

  this._ending = true;
  this._converter.stdin.end();
};
