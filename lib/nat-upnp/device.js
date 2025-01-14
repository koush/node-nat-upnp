var nat = require('../nat-upnp'),
    url = require('url'),
    xml2js = require('xml2js'),
    Buffer = require('buffer').Buffer;

var device = exports;

function Device(url) {
  this.description = url;
  this.services = [
    'urn:schemas-upnp-org:service:WANIPConnection:1',
    'urn:schemas-upnp-org:service:WANPPPConnection:1',
    'urn:schemas-upnp-org:service:WANIPConnection:2',
    'urn:schemas-upnp-org:service:WANPPPConnection:2',
  ];
};

device.create = function create(url) {
  return new Device(url);
};

Device.prototype._getXml = function _getXml(url, callback) {
  var once = false;
  function respond(err, body) {
    if (once) return;
    once = true;

    callback(err, body);
  }

  fetch(url).then(res => {
    if (res.status !== 200) {
      respond(Error('Failed to lookup device description'));
      return;
    }
    return res.text();
  }).then(body => {
    var parser = new xml2js.Parser();
    parser.parseString(body, function(err, body) {
      if (err) return respond(err);

      respond(null, body);
    });
  })
  .catch(callback);
};

Device.prototype.getService= function getService(types, callback) {
  var self = this;

  this._getXml(this.description, function(err, info) {
    if (err) return callback(err);

    var s = self.parseDescription(info).services.filter(function(service) {
      return types.indexOf(service.serviceType[0]) !== -1;
    });

    if (s.length === 0 || !s[0].controlURL || !s[0].SCPDURL) {
      return callback(Error('Service not found'));
    }

    var base = url.parse(info.baseURL || self.description);
    function prefix(u) {
      var uri = url.parse(u);

      uri.host = uri.host || base.host;
      uri.protocol = uri.protocol || base.protocol;

      return url.format(uri);
    }

    callback(null,{
      service: s[0].serviceType[0],
      SCPDURL: prefix(s[0].SCPDURL[0]),
      controlURL: prefix(s[0].controlURL[0])
    });
  });
};

Device.prototype.parseDescription = function parseDescription(info) {
  var services = [],
      devices = [];

  function toArray(item) {
    return Array.isArray(item) ? item : [ item ];
  };

  function traverseServices(service) {
    if (!service) return;
    services.push(service);
  }

  function traverseDevices(device) {
    if (!device) return;
    devices.push(device);

    if (device.deviceList && device.deviceList[0].device) {
      toArray(device.deviceList[0].device).forEach(traverseDevices);
    }

    if (device.serviceList && device.serviceList[0].service) {
      toArray(device.serviceList[0].service).forEach(traverseServices);
    }
  }

  traverseDevices(info.root.device[0]);

  return {
    services: services,
    devices: devices
  };
};

Device.prototype.run = function run(action, args, callback) {
  var self = this;

  this.getService(this.services, function(err, info) {
    if (err) return callback(err);

    var body = '<?xml version="1.0"?>' +
               '<s:Envelope ' +
                 'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
                 's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
               '<s:Body>' +
                  '<u:' + action + ' xmlns:u=' +
                          JSON.stringify(info.service) + '>' +
                    args.map(function(args) {
                      return '<' + args[0]+ '>' +
                             (args[1] === undefined ? '' : args[1]) +
                             '</' + args[0] + '>';
                    }).join('') +
                  '</u:' + action + '>' +
               '</s:Body>' +
               '</s:Envelope>';

    fetch(info.controlURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'close',
        'SOAPAction': JSON.stringify(info.service + '#' + action)
      },
      body: body
    }).then(res => {
      if (res.status !== 200) {
        throw Error('Request failed: ' + res.statusCode);
      }
      return res.text();
    }).then(body => {
      var parser = new xml2js.Parser();
      parser.parseString(body, function(err, body) {
        if (err) return callback(err);

        var soapns = nat.utils.getNamespace(
          body,
          'http://schemas.xmlsoap.org/soap/envelope/');

        callback(null, body[soapns + 'Body']);
      });
    })
    .catch(callback);
  });
};
