



var sensorController = (function () {
  var W1Temp = require('w1temp');
  var mqtt = require('mqtt');
  var mqttClient;
  var brokerAddress;
  // THE FOLLOWING ARE THE AUTHENTICATION CREDENTIALS FOR THE MQTT BROKER
  // CHANGE THESE IF DIFFERENT CREDENTIALS ARE DESIRED.  REMEMBER TO ALSO CHANGE THESE IN THE MASTER. 
  var brokerUsername = 'still';
  var brokerPassword = 'pi';
  var connectToBroker = true;
  var sensorIDs;
  
  var sensorHandler = function (temperature) {
    var num = this.file.split('/').length - 2;
    console.log('Sensor UID:', this.file.split('/')[num], 'Temperature: ', temperature.toFixed(3), '°C   ');
    mqttClient.publish('stillpi/sensors/report', JSON.stringify({ 'sensorid': this.file.split('/')[num], 'value': temperature.toFixed(3), units: 'C'}), (err, granted) => {console.log("err: ", err, ",   granted: ", granted)});
  };


  var mqttMessageHandler = function (topic, message) {
    console.log( '  sensorController:mqttMessageHandler:topic: ', topic);
    console.log( '  sensorController:mqttMessageHandler:message: ', message.toString('utf8'));
    // Dispatch messages to the relevant handler.  
    switch (topic) {
      case 'stillpi/sensors/identify/invoke':
        console.log('Announce message recieved.');
        announceSensors();
	      var sensorClass = JSON.parse(message.toString('utf8')).class;
        if (sensorClass === 'all' || sensorClass === 'temperature') {
            console.log('Announcing sensors.');
            announceSensors();
        }
        break;

      case 'stillpi/sensors/ping':
      var pingSensorID = JSON.parse(message.toString('utf8')).sensorid;
      // var pingSensorID = message.sensorid;
      console.log('Ping for sensor: ', pingSensorID);
      if (sensorIDs.includes(pingSensorID)) {
        console.log('Responding to ping on sensor: ', pingSensorID);
        mqttClient.publish('stillpi/sensors/ping/', JSON.stringify({'type': 'response', 'sensorid': pingSensorID}), (err, granted) => {console.log("MQTT message sent.  err: ", err, ",   granted: ", granted)});
      }
      break;
    }
  };


  var announceSensors = function () {
    sensorIDs.forEach(sensor => {
      W1Temp.getSensor(sensor).then(function(sensorInstance) {
        console.log('Announcing: ', sensor);
        mqttClient.publish('stillpi/sensors/identify/announce', JSON.stringify({ 'sensorid': sensor, 'class' : 'temperature', value: sensorInstance.getTemperature(), units: 'C'}), (err, granted) => {console.log("err: ", err, ",   granted: ", granted)});
      });
    });
  };

  // Scan for all connected sensors and add/delete sensors that are new/gone with master node.  
  var updateSensors = function () {
    console.log('Updating sensor list.');
    // Get the list of currently connected sensors.  
    W1Temp.getSensorsUids()
    .then( function( sensors ) {
      // Look for new sensors and anounce them when found.
      sensors.forEach( sensor => {
        if (!sensorIDs.includes(sensor)) {
          // Anounce the new sensor.  
          mqttClient.publish('stillpi/sensors/identify/announce', JSON.stringify({ 'sensorid': sensor, 'class' : 'temperature'}), (err, granted) => {console.log("err: ", err, ",   granted: ", granted)});
        }
      });
      
      // Look for sensors that went away since last sweep and let master node know if any found.  
      sensorIDs.forEach( sensor => {
        if (!sensors.includes(sensor)) {
          // Anounce the new sensor.  
          mqttClient.publish('stillpi/sensors/identify/delete', JSON.stringify({ 'sensorid': sensor, 'class' : 'temperature'}), (err, granted) => {console.log("err: ", err, ",   granted: ", granted)});
        }
      });

      // Update the seonsor list.  
      sensorIDs = sensors;
    });
  };

  return {
    init: function () {
      console.log('Initializing sensor controller.');

      // Find MQTT broker IP address.  
      var mdns = require('mdns');
      console.log('Searching for MQTT broker.');
      // This next line is required on Raspberry Pi per:
      //   https://github.com/agnat/node_mdns/issues/130
      mdns.Browser.defaultResolverSequence[1] = 'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({families:[4]});
      var browser = mdns.createBrowser(mdns.tcp('mqtt'));
      browser.on('serviceUp', function(service) {
        console.log("MQTT service found. Name: ", service.name);
        if (service.name === 'stillpi' && connectToBroker) {
          connectToBroker = false;
          brokerAddress = 'mqtt://' + service.addresses[0];
          console.log('Connecting to MQTT broker.')
          //Setup the MQTT client that this sensor controller uses to receive sensor data from the master.  
          var options = {
            username: brokerUsername,
            password: Buffer.alloc(brokerPassword.length, brokerPassword) // Passwords are buffers
          } 
          console.log('Broker address: ', brokerAddress);
          console.log('Credentials: ', options);
          mqttClient  = mqtt.connect(brokerAddress, options);
          // Subscribe to relevant topics.  
          mqttClient.on('connect', function () {
              console.log('Connected to MQTT broker.')
              mqttClient.subscribe('stillpi/sensors/identify/invoke');
              mqttClient.subscribe('stillpi/sensors/ping');
              announceSensors();
          }); 
          // Setup handler to dispatch incoming MQTT messages.  
          mqttClient.on('message', mqttMessageHandler);

          // Setup temperature sensor library.  
          W1Temp.getSensorsUids()
          .then( function( sensors ) {
            sensorIDs = sensors;
            console.log(sensors);
            for (var currentSensor of sensors) {
                // get instance of temperature sensor
                W1Temp.getSensor(currentSensor)
                .then( function (sensor) {
                  // Setup handler for sensor temperature changes.  
                  sensor.on('change', sensorHandler);
                });
            }
            // announceSensors();
          })
        }
      });
      browser.start();

      // Schedule periodic scan for new sensors every 5 minutes.
      // setInterval( () => {
      //   updateSensors();
      // }, 300000);
      
      
    },

    getSensorUIDs: function () {
      return sensors;
    },

    updateSensors: function () {
      W1Temp.getSensorsUids()
      .then( function( sensors ) {
        sensorIDs = sensors;
        console.log(sensors);
        for (var currentSensor of sensors) {
            // get instance of temperature sensor
            W1Temp.getSensor(currentSensor)
            .then( function (sensor) {
              // Setup handler for sensor temperature changes.  
              sensor.on('change', sensorHandler);
            });
        }
      });
    }
  };

})();

var mqttController = (function () {

})();
  
    
// GLOBAL APP CONTROLLER                    
var controller = (function (sensorCtrl, mqttCtrl) {
  var privateMethod = function () {
  };

  return {
    init: function () {
      console.log('Application starting.');  

      // Initialize the sensor controller.  
      sensorController.init();

      console.log('Application has started.');  
    }
}

})(sensorController, mqttController);


controller.init(