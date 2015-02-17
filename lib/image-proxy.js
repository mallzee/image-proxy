// @see https://devcenter.heroku.com/articles/nodejs#write-your-app

var express = require('express')
  , fs      = require('fs') // node
  , gm      = require('gm')
  , http    = require('http') // node
  , https   = require('https') // node
  , mime    = require('mime')
  , url     = require('url') // node
  // @see http://aaronheckmann.posterous.com/graphicsmagick-on-heroku-with-nodejs
  , app = express()
  , imageMagick = gm.subClass({imageMagick: true})
  , whitelist = process.env.WHITELIST || [] // [/\.gov$/, /google\.com$/]
  , delay = parseInt(process.env.DELAY) || 5000
  , mimeTypes = [
    'image/gif',
    'image/jpeg',
    'image/png',
    // Common typos
    'image/jpg',
    'image/pjpeg'
  ];

var MAX_WIDTH = parseInt(process.env.MAX_WIDTH) || 4096;
var MAX_HEIGHT = parseInt(process.env.MAX_HEIGHT) || 4096;

module.exports = function () {

  app.get('/:url/:width/:height', function (req, res, next) {
    var width = req.params.width
      , height = req.params.height
      , retrieve = function (remote) {
        // @see http://nodejs.org/api/url.html#url_url
        var parts = url.parse(remote);
        // @see https://github.com/substack/hyperquest
        parts.agent = false;
        if (parts.protocol !== 'http:' && parts.protocol !== 'https:') {
          return res.status(404).send('Expected URI scheme to be HTTP or HTTPS');
        }
        if (!parts.hostname) {
          return res.status(404).send('Expected URI host to be non-empty');
        }

        var agent = parts.protocol === 'http:' ? http : https
          , timeout = false
          // @see http://nodejs.org/api/http.html#http_http_get_options_callback
          , request = agent.get(parts, function (response) {
            if (timeout) {
              // Status code 504 already sent.
              return;
            }

            // @see http://nodejs.org/api/http.html#http_response_statuscode
            if ((response.statusCode === 301 || response.statusCode === 302) && response.headers['location']) {
              var redirect = url.parse(response.headers['location']);
              // @see https://tools.ietf.org/html/rfc7231#section-7.1.2
              if (!redirect.protocol) {
                redirect.protocol = parts.protocol;
              }
              if (!redirect.hostname) {
                redirect.hostname = parts.hostname;
              }
              if (!redirect.port) {
                redirect.port = parts.port;
              }
              if (!redirect.hash) {
                redirect.hash = parts.hash;
              }
              return retrieve(url.format(redirect));
            }

            // The image must return status code 200.
            if (response.statusCode !== 200) {
              return res.status(404).send('Expected response code 200, got ' + response.statusCode);
            }

            // The image must be a valid content type.
            // @see http://nodejs.org/api/http.html#http_request_headers
            var mimeType = (response.headers['content-type'] || '').replace(/;.*/, '');
            if (mimeTypes.indexOf(mimeType) === -1) {
              return res.status(404).send('Expected content type ' + mimeTypes.join(', ') + ', got ' + mimeType);
            }

            // @see https://github.com/aheckmann/gm#constructor
            imageMagick(response, 'image.' + mime.extension(mimeType))
            // @see http://www.imagemagick.org/Usage/thumbnails/#cut
            .resize(width, height, + '@^')
            .gravity('Center') // faces are most often near the center
            .extent(width, height)
            .stream(function (err, stdout, stderr) {
              if (err) return next(err);
              // Log errors in production.
              stderr.pipe(process.stderr);
              // @see http://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html
              res.writeHead(200, {
                'Content-Type': mimeType,
                'Cache-Control': 'max-age=31536000, public', // 1 year
              });
              stdout.pipe(res);
            });
          }).on('error', next);

        // Timeout after five seconds. Better luck next time.
        request.setTimeout(delay, function () {
          timeout = true; // if we abort, we'll get a "socket hang up" error
          return res.status(504).send();
        });
      };

    // Validate parameters.
    if (whitelist.length) {
      var parts = url.parse(req.params.url);
      if (parts.hostname) {
        var any = false, _i, _len;
        if (typeof whitelist === 'string') {
          whitelist = whitelist.split(',');
        }
        for (_i = 0, _len = whitelist.length; _i < _len; _i++) {
          if (typeof whitelist[_i] === 'string') {
            // Escape periods and add anchor.
            whitelist[_i] = new RegExp(whitelist[_i].replace('.', '\\.') + '$')
          }
          if (whitelist[_i].test(parts.hostname)) {
            any = true;
            break;
          }
        }
        if (!any) { // if none
          return res.status(404).send('Expected URI host to be whitelisted');
        }
      }
    }
    if (isNaN(parseInt(width))) {
      return res.status(404).send('Expected width to be an integer');
    }
    if (parseInt(width) > MAX_WIDTH) {
      return res.status(404).send('Expected width to be less than or equal to ' + MAX_WIDTH);
    }
    if (isNaN(parseInt(height))) {
      return res.status(404).send('Expected height to be an integer');
    }
    if (parseInt(height) > MAX_HEIGHT) {
      return res.status(404).send('Expected height to be less than or equal to ' + MAX_HEIGHT);
    }

    retrieve(req.params.url);
  });

  return app;
};
