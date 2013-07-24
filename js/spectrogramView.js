var app = app || {};

(function () {
	'use strict';

	// VIEW OF THE SPECTROGRAM 
	// -----------------------
	app.SpectrogramView = Backbone.View.extend({

		tagName:  'canvas',
		colors: {
			microphone: 'rgba(255, 0, 0, ',
			soundfile: 'rgba(0, 255, 0, '
		}, 

		initialize: function () {

			this.ctx = this.options.ctx;

			this.spectrogramSize = this.model.get('fftSize')/2;
			this.xLength = 500;
			this.count = 0;

			this.listenTo(this.model, "sourceChanged", this.changeColor);
	    this.listenTo(this.model, "spectrogramChange", this.update);
		},


		update: function (spec) {
			if (this.model.get('playing')) {
				this.count++;
				this.drawSpectrogramPart(spec, this.count);
				console.log('woa');
			}
			if (this.count > this.xLength) {
				this.clearCanvas();
				this.count = 0;
			}
		},


		changeColor: function () {
			this.drawingColor = this.colors[this.model.get('currState').get('name')];
		},


		clearCanvas: function() {
			var c = this.ctx.canvas;
			this.ctx.clearRect(0, 0, c.width, c.height);
		},


		drawSpectrogramPart: function (spec, index) {
			var ctx = this.ctx;
			var c = ctx.canvas;
			var l = this.xLength;
			var h = this.spectrogramSize;
			var color = this.drawingColor;

			var xScale = c.width/l;
			var dy = -c.height/h;

			var xStart = index*xScale;
			var yStart = c.height;
			for (var i = 0; i < spec.length; i++) {

				ctx.fillStyle = color + spec[i]/255*4 + ')';
				if(spec[i] > 0) {
					console.log(color);
				}
				ctx.fillRect(xStart,yStart,xScale,dy);		
				
				yStart += dy;
			};
		}
	});
})();