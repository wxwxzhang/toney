var app = app || {};

(function () {
	'use strict';

	// STATE PATTERN
	// these states are used by the spectrogramModel to keep track of inputsources
	// ---------------------------------------------------------------

	var BaseState = Backbone.Model.extend({
		initialize: function(owner) {
			this._analyser = owner;
		}
	});

	var MicrophoneState = BaseState.extend({
		defaults: {
			index: 0,
			name: "microphone" 
		},
		execute: function() {
			this._analyser.connectMicrophone();
			this._analyser.startSoundAnalysis();
		},
		exit: function() {
			this._analyser.stopSoundAnalysis();
			this._analyser.disconnectMicrophone();
		},
		update: function () {
			this._analyser.trigger('microphone:updated', this._analyser._spectrogram);
		}
	});

	var SoundfileState = BaseState.extend({
		defaults: {
			index: 1,
			name: "soundfile" 
		},
		execute: function() {
			this._analyser.connectSoundfile();
			this._analyser.startSoundAnalysis();
		},
		exit: function() {
			this._analyser.stopSoundAnalysis();
			this._analyser.disconnectSoundfile();
		},
		update: function () {
			this._analyser.trigger('soundfile:updated', this._analyser._spectrogram);
		}
	});

	var ProcessingState = BaseState.extend({
		defaults: {
			index: 2,
			name: "processing" 
		},
		execute: function() {
			this._analyser.set({ 'processing': true });
			console.log('processing ...');
		},
		exit: function() {
			this._analyser.set({ 'processing': false });
			console.log('finished processing');
		}
	});
	
	// ONLY USE ONE AUDIOCONTEXT
	var audioContext = null;

	// THE MODEL WHICH OUTPUTS A SPECTROGRAM TO LISTENING VIEWS AND/OR MODELS
	// -----------------------------------------------------------------------

	app.SpectrogramModel = Backbone.Model.extend({

		// DEFAULT PARAMETERS
		// ------------------

		defaults: {
			fftSize: 2048,
			spectrogramSize: 300,
			smoothing: 0.0,
			bandpass: {
				fMin: 160,
				fMax: 3400,
				qFactor: 0.05
			},
			soundfileSource: 'audio/ma_short.mp3',
			currState: null,
			downsampleRate: 4,
			playing: false,
			processing: false,
			externalAnalyser: false,
			audioNodes: []
		},

		// INITIALIZE THE WHOLE AUDIO SETUP FOR SPECTROGRAM ANALYSIS
		// ------------------------------- 

		initialize: function() {
			// cross-browser retrieval of neccessary Web Audio API context providers and the ability to get users microphone input
			var vendors = ['', 'ms', 'moz', 'webkit', 'o'];
			for(var x = 0; x < vendors.length && (!window.AudioContext || !navigator.getUserMedia); ++x) {
					window.AudioContext = window[vendors[x]+'AudioContext'];
					navigator.getUserMedia = navigator[vendors[x]+'GetUserMedia'];
			}
			if (!window.AudioContext || !navigator.getUserMedia) {
				alert('THIS APPlICATION REQUIRES "Web Audio Input" ENABLED IN chrome://flags.');
			}

			audioContext = new AudioContext();

			this._states = {
					microphone: new MicrophoneState(this),
					soundfile: new SoundfileState(this),
					processing: new ProcessingState(this)
			};

			// enter processingstate while waiting for microphone and soundfile
			this.changeState(this._states.processing);
			
			// PREPARE ANALYSEROTPUT, MICROPHONE AND SOUNDFILE, ONE AT THE TIME 
			this._analysisOutputNode = (this.get('externalAnalyser')) ? this.initializeDSP() // External DSP.js analysis 
			: this.initializeAnalyser(); // Web Audio API:s built  in

			this.initializeMicrophone();
			this.once('microphone:ready', this.initializeSoundfile, this);
			this.once('soundfile:loaded', this.createSoundFileNode, this);
			this.once('soundfile:ready', this.initializeAudioGraph, this);
			this.once('audiograph:ready', this.inputToggle, this);
				
			// PERMANENT EVENT BINDINGS
			// ---------------------------
			this.on('soundfile:ended', this.resetSoundfile, this);
		},

		// MICROPHONE METHODS
		// ------------------------------------

		initializeMicrophone: function () {
			navigator.getUserMedia( {audio:true}, this.createMicrophoneNode.bind(this) , function(err) {console.log(err);} );
		},
		createMicrophoneNode: function (stream) {
			this._microphoneInput = audioContext.createMediaStreamSource( stream );
			console.log('mic node created');
			this.trigger('microphone:ready');
		},
		connectMicrophone: function () {
			this._microphoneInput.connect(this._analysisInputNode);
		},
		disconnectMicrophone: function () {
			this._microphoneInput.disconnect();
		},

		// SOUNDFILE METHODS
		// --------------------------------------

		initializeSoundfile: function () {
			this._audio = new Audio(this.get('soundfileSource'));
			this._audio.preload = false;
			this._audio.addEventListener("canplay", function () {
				this.trigger('soundfile:loaded');
			}.bind(this));
			this._audio.addEventListener("ended", function () {
				this.trigger('soundfile:ended');
			}.bind(this));
			this._audio.autoplay = false;
		},
		createSoundFileNode: function () {
			this._soundFileInput = audioContext.createMediaElementSource(this._audio);
			this.trigger('soundfile:ready');
		},
		connectSoundfile: function () {
			this._soundFileInput.connect(this._analysisInputNode);
			this._soundFileInput.connect(audioContext.destination);
			this._audio.play();
			this.set({ playing: true });
		},
		disconnectSoundfile: function () {
			this._soundFileInput.disconnect();
			this._audio.pause();
			this.set({ playing: false });
		},
		resetSoundfile: function () {
			// reload audio because setting this._audio.currentTime is not working, 
			// might be because of currently immature Web Audio API?
			this.initializeSoundfile();	
			this.once('soundfile:loaded', this.createSoundFileNode, this);
			this.once('soundfile:ready', this.inputToggle, this);
		},

		// ANALYSER METHODS
		// --------------------------------------

		initializeAnalyser: function () {
			var analyser = audioContext.createAnalyser();
			analyser.fftSize = this.get('fftSize');
			analyser.smoothingTimeConstant = this.smoothing;
			this._data = new Uint8Array(analyser.frequencyBinCount);
			this._spectrogram = new Uint8Array(this.get('spectrogramSize'));
			return analyser;
		},
		startSoundAnalysis: function() {
			this._animationID = (this.get('externalAnalyser')) ? 
			window.requestAnimationFrame(this.updateSpectrogramDSP.bind(this))
			: window.requestAnimationFrame(this.updateSpectrogram.bind(this));
		},
		stopSoundAnalysis: function() {
			if ( this._animationID ) {
				window.cancelAnimationFrame(this._animationID);
			}
			this._animationID = 0;
		},
		updateSpectrogram: function () {
			this._analysisOutputNode.getByteFrequencyData(this._data);
			this._spectrogram = this._data.subarray(0, this.get('spectrogramSize')-1);
			this.get('currState').update();
			this._animationID = window.requestAnimationFrame(this.updateSpectrogram.bind(this));
		},
		updateSpectrogramDSP: function () {
			if (this.get('playing')) {

				var dsr = this.get('downsampleRate');

				this._fft.forward(this._buffer.data);
				this._data = this._fft.getDbSpectrum();
				this.get('currState').update();
				this._animationID = window.requestAnimationFrame(this.updateSpectrogramDSP.bind(this));
			}
			
		},

		// BUFFER INITIALIZATION FOR ANALYSIS WITH EXTERNAL DSP.JS LIBRARY

		// Following the example at 
		// http://phenomnomnominal.github.io/docs/tuner.html

		initializeDSP: function () {
			var fftSize = this.get('fftSize');
			var dsr = this.get('downsampleRate');
			var sampleRate = audioContext.sampleRate;
			console.log(sampleRate);
			this._buffer = {
				fillSize: fftSize / dsr,
				data: new Float32Array(fftSize),
				downsampled: new Float32Array(this.fillSize),
				upsampled: new Float32Array(fftSize)
			};

			this._fft = new RFFT(fftSize, sampleRate / dsr);
			this._gauss = new WindowFunction(DSP.GAUSS);

			for (var i = 0; i < fftSize; i++) {
				this._buffer.data[i] = 0;
			}

			var bufferFillerNode = audioContext.createScriptProcessor(this._buffer.fillSize, 1, 1);

			bufferFillerNode.onaudioprocess = function(e) {
				var input = e.inputBuffer.getChannelData(0);
				for (var i = this.fillSize; i < this.data.length; i++) {
					this.data[i-this.fillSize] = this.data[i];
				}
				for (i = 0; i < input.length; i++) {
					this.data[this.data.length-this.fillSize + i] = input[i];
				}

				console.log('processing and filling buffer');
			}.bind(this._buffer);

			return bufferFillerNode;
		},

		// INITIALIZE THE NODE STRUCTURE IN THE WEB AUDIO GRAPH
		// ---------------------------------------------

		initializeAudioGraph: function() {

			var  fftSize, fmin, fmax, q, bp;

			fftSize = this.get('fftSize');
			bp = this.get('bandpass');
			fmin = bp.fMin;
			fmin = bp.fMax;
			q = bp.qFactor;

			// AUDIO API GRAPH:
			// input -> lowpass -> highpass -> fft analysis node -> spectrogram data

			this._analysisInputNode = audioContext.createGainNode();

			var audioNodes = this.get('audioNodes');

			// Low-pass filter. 
			var lpF = audioContext.createBiquadFilter();
			lpF.type = lpF.LOWPASS; 
			lpF.frequency.value = fmax;
			lpF.Q = q;

			// High-pass filter. 
			var hpF = audioContext.createBiquadFilter();
			hpF.type = hpF.HIGHPASS; 
			hpF.frequency.value = fmin;
			hpF.Q = q;

			// Notch filter. 
			var pF = audioContext.createBiquadFilter();
			pF.type = hpF.PEAKING; 
			pF.frequency.value = 750;
			pF.Q = 0.16;
			pF.gain = 4.3;


			// Dynamic compressor node
			var dComp = audioContext.createDynamicsCompressor();
			dComp.threshold = -12;
			
			audioNodes.push(lpF);
			audioNodes.push(hpF);
			audioNodes.push(pF);
			audioNodes.push(dComp);

			console.log(audioNodes);

			// Connect all of the nodes
			this._analysisInputNode.connect(audioNodes[0]);
			for (var i = 0; i < audioNodes.length-1; i++) {
				audioNodes[i].connect(audioNodes[i+1]);
			};
			audioNodes[audioNodes.length-1].connect(this._analysisOutputNode);
			this._analysisOutputNode.connect(audioContext.destination);

			

			this.trigger('audiograph:ready');
		},

		// SWAP BETWEEN SOUNDFILE / MICROPHONE
		// ----------------------------------------------

		inputToggle: function() {
			if ( this.get('playing') || this.get('processing') ) {
				this.changeState(this._states.microphone);
			}
			else {
				this.changeState(this._states.soundfile);
			}
			this.trigger('sourceChanged');
		},

		// STATE PATTERN UTILITY
		// -----------------------------

		changeState: function(state) {
			var inputState = this.get('currState');
			// Make sure the current state wasn't passed in
			if (inputState !== state) {
				// Make sure the current state exists before
				// calling exit() on it
				if (inputState) {
					inputState.exit();
				}
				this.set({ currState: state });
				this.get('currState').execute();
				this.trigger('stateChanged');
			}
		},
	
	});
})();
