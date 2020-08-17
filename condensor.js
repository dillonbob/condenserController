var config = require('./configController.js');


var sensorController = (function () {
  var W1Temp = require('w1temp');
  var mqtt = require('mqtt');
  var mqttClient;
  var mdns = require('mdns');
  var brokerAddress;
  // THE FOLLOWING ARE THE AUTHENTICATION CREDENTIALS FOR THE MQTT BROKER
  // CHANGE THESE IF DIFFERENT CREDENTIALS ARE DESIRED.  REMEMBER TO ALSO CHANGE THESE IN THE MASTER. 
  var brokerUsername = 'still';
  var brokerPassword = 'pi';
  var connectToBroker = true;
  var sensorIDs = [];
  var sensorControllers = [];
 
  var sensorHandler = function (temperature) {
    var sensorInfo = {
      '28-021840339bff': 'dephleg', 
      '28-0218402ee7ff': 'product'
    };

    var num = this.file.split('/').length - 2;
    var sensorID = this.file.split('/')[num];
    // console.log("num = ", sensorID, ", sensorInfo = ", sensorInfo);
    console.log('Sensor UID:', this.file.split('/')[num], 'Temperature: ', temperature.toFixed(3), '°C, MQTT topic: ', 'stillpi/condenser/temperature', ', MQTT message: ', { condenser: sensorInfo[sensorID], temperature: temperature, units: 'C'});
    // How to get sensor ID:     'sensorid': this.file.split('/')[num]
    mqttClient.publish('stillpi/condenser/temperature', JSON.stringify({ condenser: sensorInfo[sensorID], temperature: temperature.toFixed(3), units: 'C'}), 
      (err, granted) => {
        if (typeof err !== "undefined") {
          console.log("err: ", err);
        };
        if (typeof granted !== "undefined") {
          console.log("granted: ", granted);
        }
      });
  };


  var mqttMessageHandler = function (topic, message) {

    // Messages come in a character buffers and need to be converted to JSON.  
    var jsonMessage = JSON.parse(message.toString('utf8'));

    console.log( '  sensorController:mqttMessageHandler:topic: ', topic);
    console.log( '  sensorController:mqttMessageHandler:message: ', jsonMessage);

    //  Dispatch messages to the relevant handler.  
    switch (topic) {
      case 'stillpi/condenser/paramUpdate':  // UI change to one or more parameters.  
        console.log('Parameter update message recieved: ', jsonMessage);
        console.log("Current configuration object: ", global.configProxy);
        if (jsonMessage.action === 'update') {
          switch (jsonMessage.value.param) {
            case 'power':
              global.configProxy[jsonMessage.value.condenser].state = jsonMessage.value.value;
              break;
            case 'mode':
              global.configProxy[jsonMessage.value.condenser].mode = jsonMessage.value.value;
              break;
            case 'valveSetting':
              global.configProxy[jsonMessage.value.condenser].valveSetting = jsonMessage.value.value;
              break;
            case 'targetTemp':
              global.configProxy[jsonMessage.value.condenser].targetTemp = jsonMessage.value.value;
              break;
          };
          console.log("Updated configuration object: ", global.configProxy);
          config.configController.saveConfig();
          //  announce again to update all UI clients.
          announceCondenserController();
        }

        // global.configProxy.dephleg.state = jsonMessage.dephleg.state;
        break;

      case 'stillpi/condenser/identify/invoke':
        console.log('Announce message recieved.');
        announceCondenserController();
        break;
  
      case 'stillpi/condenser/ping':
	      console.log("Ping received: ", jsonMessage);
	      if (jsonMessage.type === 'call') {
	        mqttClient.publish('stillpi/condenser/ping', JSON.stringify({'type': 'response'}));
	      }
        break;

      case 'stillpi/condenser/getParams':
        console.log("Parameter request received: ", jsonMessage);
        if (jsonMessage.type === 'request') {
          mqttClient.publish('stillpi/condenser/getParams', JSON.stringify({'type': 'response', 'config': global.configProxy}));
        }
        break;
  
  
    }
  };

  var announceCondenserController = function () {
    console.log("Announcing condenser controller");

    // RESPOND WITH CURRENT CONFIGURATION Object
    mqttClient.publish('stillpi/condenser/identify/announce', JSON.stringify(global.configProxy));
  }

  
  return {
    init: function () {
      console.log('Initializing condenser controller.');

      // Find MQTT broker IP address.  
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
            browser.stop() // You have the broaker, stop browsing.  
            console.log('Connected to MQTT broker.')
            mqttClient.subscribe('stillpi/condenser/paramUpdate');
	    mqttClient.subscribe('stillpi/condenser/identify/invoke');
            mqttClient.subscribe('stillpi/condenser/ping');
            mqttClient.subscribe('stillpi/condenser/getParams');
            announceCondenserController();
            // announceSensors();
          }); 
          mqttClient.on("error",function(error){
            console.log("MQTT connection error");
          });
          // Setup handler to dispatch incoming MQTT messages.  
          mqttClient.on('message', mqttMessageHandler);

          // Setup temperature sensor library.  
          W1Temp.getSensorsUids()
          .then( function( sensors ) {
            sensorIDs = sensors;
            console.log(sensors);

            // Setup array of sensor controllers.  
            sensorIDs.forEach(sensor => {
              W1Temp.getSensor(sensor).then(function(sensorInstance) {
                sensorControllers.push(sensorInstance);
                sensorInstance.on('change', sensorHandler);
                // console.log("sensorControllers: ", sensorControllers);
              });
            });
            

            // Schedule periodic process every 1 second.
            // setInterval( () => {

            //   if( !mqttClient.connected ) {
            //     console.log( "Reconnecting to MQTT broker" );
            //     mqttClient.reconnect();
            //   }
            // }, 15000);
          })
        }
      });
      browser.start();
    },

    getSensorUIDs: function () {
      return sensors;
    },

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
      config.configController.init();

      console.log('Application has started.');  
      console.log("Current config object: ", global.configProxy);
    }
}

})(sensorController, mqttController);


controller.init();
