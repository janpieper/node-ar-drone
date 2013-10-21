var common       = require('../../common');
var assert       = require('assert');
var test         = require('utest');
var sinon        = require('sinon');
var PngEncoder   = require(common.lib + '/video/PngEncoder');
var EventEmitter = require('events').EventEmitter;


test('PngEncoder', {
  before: function() {
    this.fakeConverter = new EventEmitter();

    this.fakeConverter.stdin       = new EventEmitter();
    this.fakeConverter.stdin.write = sinon.stub();
    this.fakeConverter.stdin.end   = sinon.stub();

    this.fakeConverter.stdout = {pipe: sinon.spy()};
    this.fakeConverter.stderr = {pipe: sinon.spy()};

    this.fakeSpawn = sinon.stub();
    this.fakeSpawn.returns(this.fakeConverter);

    this.fakePngSplitter = new EventEmitter();

    this.fakeFrameRate = 23;

    this.fakeBuffer1 = new Buffer('123');
    this.fakeBuffer2 = new Buffer('456');

    this.fakeLog = {};

    this.encoder = new PngEncoder({
      spawn       : this.fakeSpawn,
      frameRate   : this.fakeFrameRate,
      pngSplitter : this.fakePngSplitter,
      log         : this.fakeLog,
    });
  },

  'is a writable stream': function() {
    assert.equal(this.encoder.writable, true);
    assert.equal(typeof this.encoder.write, 'function');
  },

  'is a readable stream': function() {
    assert.equal(this.encoder.readable, true);
    assert.equal(typeof this.encoder.pipe, 'function');
  },

  'uses ffmpeg as default converter': function () {
    this.encoder.write(new Buffer('foo'));

    assert.equal(this.fakeSpawn.callCount, 1);
    assert.equal(this.fakeSpawn.getCall(0).args[0], 'ffmpeg');
  },

  'uses specified converter': function () {
    var encoder = new PngEncoder({
      spawn: this.fakeSpawn,
      converterPath: '/usr/bin/avconv'
    });

    encoder.write(new Buffer('foo'));

    assert.equal(this.fakeSpawn.callCount, 1);
    assert.equal(this.fakeSpawn.getCall(0).args[0], '/usr/bin/avconv');
  },

  'first write() spawns converter': function() {
    this.encoder.write(new Buffer('foo'));

    assert.equal(this.fakeSpawn.callCount, 1);
    assert.equal(this.fakeSpawn.getCall(0).args[0], 'ffmpeg');

    // Another write does not spawn another converter
    this.encoder.write(new Buffer('bar'));
    assert.equal(this.fakeSpawn.callCount, 1);
  },

  'write() spawn converter with the right arguments': function() {
    this.encoder.write(new Buffer('foo'));

    var args = this.fakeSpawn.getCall(0).args[1];

    // Read from stdin
    var input = args.indexOf('-i');
    assert.equal(args[input + 1], '-');

    // Use the image2pipe format
    var format = args.indexOf('-f');
    assert.equal(args[format + 1], 'image2pipe');

    // Use the png video codec
    var vcodec = args.indexOf('-vcodec');
    assert.equal(args[vcodec + 1], 'png');

    // Sets the right framerate
    var frameRate = args.indexOf('-r');
    assert.equal(args[frameRate + 1], this.fakeFrameRate);

    // Pipe to stdout
    assert.equal(args[args.length - 1], '-');
  },

  'write() pipes converter.stdout into PngSplitter': function() {
    this.encoder.write(new Buffer('foo'));

    var stdoutPipe = this.fakeConverter.stdout.pipe;
    assert.equal(stdoutPipe.callCount, 1);
    assert.strictEqual(stdoutPipe.getCall(0).args[0], this.fakePngSplitter);
  },

  'proxies all pngSplitter "data"': function() {
    var dataSpy = sinon.spy();
    this.encoder.on('data', dataSpy);

    this.encoder.write(new Buffer('foo'));
    this.fakePngSplitter.emit('data', this.fakeBuffer1);

    assert.equal(dataSpy.callCount, 1);
    assert.strictEqual(dataSpy.getCall(0).args[0], this.fakeBuffer1);

    this.fakePngSplitter.emit('data', this.fakeBuffer2);
    assert.equal(dataSpy.callCount, 2);
    assert.strictEqual(dataSpy.getCall(1).args[0], this.fakeBuffer2);
  },

  'handles converter spawn error': function() {
    var errorSpy = sinon.spy();
    this.encoder.on('error', errorSpy);

    this.encoder.write(new Buffer('foo'));

    // simulate converter not spawning correctly
    var error = new Error('ENOENT');
    error.code = 'ENOENT';
    this.fakeConverter.stdin.emit('error', new Error('EPIPE'));
    this.fakeConverter.emit('error', error);

    assert.equal(errorSpy.callCount, 1);
    assert.equal(/converter.*not found/i.test(errorSpy.getCall(0).args[0]), true);
  },

  'handles converter not existing': function() {
    var errorSpy = sinon.spy();
    this.encoder.on('error', errorSpy);

    this.encoder.write(new Buffer('foo'));

    // simulate converter not existing
    this.fakeConverter.stdin.emit('error', new Error('EPIPE'));
    this.fakeConverter.emit('exit', 127);

    assert.equal(errorSpy.callCount, 1);
    assert.equal(/converter.*not found/i.test(errorSpy.getCall(0).args[0]), true);
  },

  'handles converter exit code > 0': function() {
    var errorSpy = sinon.spy();
    this.encoder.on('error', errorSpy);

    this.encoder.write(new Buffer('foo'));

    // simulate an converter error
    this.fakeConverter.emit('exit', 1);

    assert.equal(errorSpy.callCount, 1);
    assert.equal(/converter.*error/i.test(errorSpy.getCall(0).args[0]), true);
  },

  'handles expected converter shutdown': function() {
    var endSpy = sinon.spy();
    this.encoder.on('end', endSpy);

    this.encoder.write(new Buffer('foo'));
    this.encoder.end();
    this.fakeConverter.emit('exit', 0);

    assert.equal(endSpy.callCount, 1);
  },

  'handles unexpected converter shutdown with exit code 0': function() {
    var errorSpy = sinon.spy();
    this.encoder.on('error', errorSpy);

    this.encoder.write(new Buffer('foo'));
    this.fakeConverter.emit('exit', 0);

    assert.equal(errorSpy.callCount, 1);
    assert.equal(/unexpected.*converter/i.test(errorSpy.getCall(0).args[0].message), true);
  },

  'write() passes all data into converter.stdin': function() {
    this.encoder.write(this.fakeBuffer1);

    var stdin = this.fakeConverter.stdin;
    assert.equal(stdin.write.callCount, 1);
    assert.strictEqual(stdin.write.getCall(0).args[0], this.fakeBuffer1);

    this.encoder.write(this.fakeBuffer2);
    assert.equal(stdin.write.callCount, 2);
    assert.strictEqual(stdin.write.getCall(1).args[0], this.fakeBuffer2);
  },

  'write() handles converter backpressure': function() {
    this.fakeConverter.stdin.write.returns(true);
    var r = this.encoder.write(new Buffer('abc'));
    assert.equal(r, true);

    this.fakeConverter.stdin.write.returns(false);
    r = this.encoder.write(new Buffer('abc'));
    assert.equal(r, false);

    var drainCalled = false;
    this.encoder.on('drain', function () {
        drainCalled = true;
    });
    this.fakeConverter.stdin.emit('drain');
    assert.ok(drainCalled);
  },

  'write() pipes converter stderr to log': function() {
    this.encoder.write(new Buffer('abc'));

    var stderrPipe = this.fakeConverter.stderr.pipe;
    assert.equal(stderrPipe.callCount, 1);
    assert.strictEqual(stderrPipe.getCall(0).args[0], this.fakeLog);
  },

  'write() does not pipe to log if not set': function() {
    this.encoder = new PngEncoder({spawn: this.fakeSpawn});

    this.encoder.write(new Buffer('abc'));
    assert.equal(this.fakeConverter.stderr.pipe.callCount, 0);
  },

  'end() closes converter.stdin': function() {
    this.encoder.write(new Buffer('abc'));
    this.encoder.end();

    assert.equal(this.fakeConverter.stdin.end.callCount, 1);
  },

  'end() does not do anything if there is no converter yet': function() {
    this.encoder.end();
  },
});
