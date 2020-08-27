var config = require('./configController.js');



var valveController = (function () {
  const raspi = require('raspi');
  const pwm = require('raspi-pwm');
  const liquidPID = require('liquid-pid');
  const pidInterval = 2;  // In seconds.  PID update interval.  
  const maxPidPower = 1000;
  const minAutoValvePosition = 10;  //  In auto mode the valve can never completely close otherwise we cannot read water temperature.  
  const pidParms = {
    Kp: 25,
    Ki: 1000,
    Kd: 9
  };
  const pidValveStartingPosition = 10;   //  This is the valve starting position for PID control.  There needs to be enough flow to measure the condenser water temperature.  Valve position is expressed from 0 - 100;

  var productValve;  // PWM controls
  var dephlegValve;

  var productPid;  // PID controllers
  var dephlegPid;

  // This function fires periodically (pidInterval) and updates the PID library and adjusts the valve.  
  const valveIntervalStart = function () {
    // Only process if the condenser is in 'auto' mode and power is on.  
    // console.log("Starting periodic valve PID control function ...");
    // global.configProxy[condenser].targetTemp

    pidProcess('product');
    pidProcess('dephleg');
  };

const pidProcess = function (condenser) {
  // console.log("Condenser: ", condenser, ", config object: ", global.configProxy[condenser]);
  if ((global.configProxy[condenser].mode === 'auto') && (global.configProxy[condenser].state === 'on')) {
    let currentTemp = sensorController.getTemperature(condenser);
    let pidOutput;
    let targetTemp;
    
    switch (condenser) {
      case 'product':
        pidOutput = productPid.calculate(currentTemp);
        targetTemp = productPid.getRefTemperature();
        break;

      case 'dephleg':
      pidOutput = dephlegPid.calculate(currentTemp);
      targetTemp = dephlegPid.getRefTemperature();
      break;
    };

    let valvePosition = (1 - (pidOutput/maxPidPower)) * 100;  //  Ensure that the valve never closes more than the minimum required to read temperature. 
    if (valvePosition < minAutoValvePosition) {
      valvePosition = minAutoValvePosition;
    };
    console.log("current temperature for ", condenser, " condenser: ", currentTemp, ", target Temp: ", targetTemp, ", PID output: ", pidOutput, ", valve position: ", valvePosition, "%\n\n");

    valveController.setValvePosition(condenser, valvePosition);
    valveController.uiValvePosition(condenser, valvePosition);
  }
};

 
  const initAutoMode = function (condenser) {
    valveController.initPID(condenser);                   //  Initialize the PID controller to start a new session.  All internal parameters reset.  
    // console.log("initAutoMode pidValveStartingPosition: ", pidValveStartingPosition);
    valveController.setValvePosition(condenser, pidValveStartingPosition);       //  Put the valve in the starting position for PID control.  
    valveController.uiValvePosition(condenser, pidValveStartingPosition);        //  Update the UI with the new position.  
  };

  var fToC = function (temp) {
    return (temp - 32) * (5 / 9);
  };

  return {
    init: function () {
      // console.log("Initializing the product condenser valve: ", productInit/100);
      productValve = new pwm.PWM('P1-12');
      // productValve.write(productInit/100);

      // console.log("Initializing the dephleg condenser valve: ", dephlegInit/100);
      dephlegValve = new pwm.PWM('P1-33');    
      // dephlegValve.write(dephlegInit/100);

      // Initialize PID Controllers
      if ((global.configProxy.product.state === 'on') && (global.configProxy.product.mode === 'auto')) {
        initAutoMode('product');
      }
      if ((global.configProxy.dephleg.state === 'on') && (global.configProxy.dephleg.mode === 'auto')) {
        initAutoMode('dephleg');
      }

      // Setup a function to run periodically for PID mode of valve control.  
      setInterval( function() {
        valveIntervalStart();
      }, pidInterval * 1000);
    },

    setValvePosition: function (condenser, value) {
      // console.log("setValvePosition parameters: condenser: ", condenser, ",  value: ", value);
      switch (condenser) {
        case 'product':
          productValve.write(value/100);
          break;

        case 'dephleg':
          dephlegValve.write(value/100);
          break;
      };
    },

    uiValvePosition: function (condenser, value) {
      // {'condenser': message.condenser, 'param': 'valveSetting', 'value': message.temperature}
      sensorController.publishMqttMessage('stillpi/condenser/valvePosition', {'condenser': condenser, 'param': 'valveSetting', 'value': value});
      // mqttClient.publish('stillpi/condenser/valvePosition', JSON.stringify({'condenser': condenser, 'param': 'valveSetting', 'value': value}));
    },

    initPID: function (condenser) {
      let tempParms = {
        temp: {
          ref: fToC(global.configProxy[condenser].targetTemp)         // Point temperature                                       
        },
        Pmax: maxPidPower,       // Max power (output),
        
        // Tune the PID Controller
        Kp: pidParms.Kp,           // PID: Kp
        Ki: pidParms.Ki,         // PID: Ki
        Kd: pidParms.Kd             // PID: Kd
      }
      console.log("Initialize ", condenser,"PID");
      if(condenser === 'product') {
          productPid = new liquidPID(tempParms);
      }
      else {  // Dephleg
        dephlegPid = new liquidPID(tempParms);
      }
    },    

    initAutoMode: function (condenser) {
      initAutoMode(condenser);
    },

    getPidValveStartingPosition: function () {
      return pidValveStartingPosition;
    },
  };
})();


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
  let initCompleted = false;
  var sensorIDs = [];
  var sensorControllers = [];
  let sensorTemps = {
    'dephleg': 0,
    'product': 0
  }
 
  var sensorHandler = function (temperature) {
    var sensorInfo = {
      '28-021840339bff': 'dephleg', 
      '28-0218402ee7ff': 'product'
    };

    var num = this.file.split('/').length - 2;
    var sensorID = this.file.split('/')[num];
    let condenser = sensorInfo[sensorID];

    sensorTemps[condenser] = temperature;

    // console.log("num = ", sensorID, ", sensorInfo = ", sensorInfo);
    // console.log('Sensor UID:', this.file.split('/')[num], 'Temperature: ', temperature.toFixed(3), '°C, MQTT topic: ', 'stillpi/condenser/temperature', ', MQTT message: ', { condenser: condenser, temperature: temperature, units: 'C'});
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

    // console.log( '  sensorController:mqttMessageHandler:topic: ', topic);
    // console.log( '  sensorController:mqttMessageHandler:message: ', jsonMessage);

    //  Dispatch messages to the relevant handler.  
    switch (topic) {
      case 'stillpi/condenser/paramUpdate':  // UI change to one or more parameters.  
        // console.log('Parameter update message recieved: ', jsonMessage);
        // console.log("Current configuration object: ", global.configProxy);
        if (jsonMessage.action === 'update') {
          switch (jsonMessage.value.param) {

            case 'power':
              global.configProxy[jsonMessage.value.condenser].state = jsonMessage.value.value;
              //  If the command turns the power off, close the valve and then update the global parameter object.  
              // If the command turns the power on, set the valve to the last stored value if in 'manual' mode or setup the PID if in 'auto' mode.  .  
              if(jsonMessage.value.value === 'on') {
                if(global.configProxy[jsonMessage.value.condenser].mode === 'manual'){
                  valveController.setValvePosition(jsonMessage.value.condenser, global.configProxy[jsonMessage.value.condenser].valveSetting);
                } 
                else {  // 'auto' mode initialize the PID controller.  
                  // console.log("Power turned on.  Initializing the PID controller, setting the valve position to the starting value and updating the UI with that position.")
                  valveController.initAutoMode(jsonMessage.value.condenser);
                }
              }
              else {   //  Powering off
                valveController.setValvePosition(jsonMessage.value.condenser, 0);
              };
              break;

            case 'mode':
              global.configProxy[jsonMessage.value.condenser].mode = jsonMessage.value.value;
              if (jsonMessage.value.value === 'auto') {  //  If the mode is switching to 'auto', initialize the PID controller.  
                valveController.initAutoMode(jsonMessage.value.condenser);
              }
              else {
                valveController.setValvePosition(jsonMessage.value.condenser, global.configProxy[jsonMessage.value.condenser].valveSetting);
              }
              break;

            case 'valveSetting':
              global.configProxy[jsonMessage.value.condenser].valveSetting = jsonMessage.value.value;
              valveController.setValvePosition(jsonMessage.value.condenser, jsonMessage.value.value);
              break;

            case 'targetTemp':
              global.configProxy[jsonMessage.value.condenser].targetTemp = jsonMessage.value.value;
              valveController.initPID(jsonMessage.value.condenser, jsonMessage.value.value);
              break;
          };
          // console.log("Updated configuration object: ", global.configProxy);
          config.configController.saveConfig();
          //  announce again to update all UI clients.
          announceCondenserController();
        }

        // global.configProxy.dephleg.state = jsonMessage.dephleg.state;
        break;

      case 'stillpi/condenser/identify/invoke':
        // console.log('Announce message recieved.');
        announceCondenserController();
        break;
  
      case 'stillpi/condenser/ping':
	      // console.log("Ping received: ", jsonMessage);
	      if (jsonMessage.type === 'call') {
	        mqttClient.publish('stillpi/condenser/ping', JSON.stringify({'type': 'response'}));
	      }
        break;

      case 'stillpi/condenser/getParams':
        // console.log("Parameter request received: ", jsonMessage);
        if (jsonMessage.type === 'request') {
          mqttClient.publish('stillpi/condenser/getParams', JSON.stringify({'type': 'response', 'config': global.configProxy}));
        }
        break;
  
  
    }
  };

  var announceCondenserController = function () {
    // console.log("Announcing condenser controller");

    // RESPOND WITH CURRENT CONFIGURATION Object
    mqttClient.publish('stillpi/condenser/identify/announce', JSON.stringify(global.configProxy));

    if(global.configProxy.product.mode === 'auto'){
      valveController.uiValvePosition('product', valveController.getPidValveStartingPosition());        //  Update the UI with the new position. 
    }
    if(global.configProxy.dephleg.mode === 'auto'){
      valveController.uiValvePosition('dephleg', valveController.getPidValveStartingPosition());        //  Update the UI with the new position. 
    }   
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
            browser.stop() // You have the broker, stop browsing.  
            console.log('Connected to MQTT broker.')
            mqttClient.subscribe('stillpi/condenser/paramUpdate');
	          mqttClient.subscribe('stillpi/condenser/identify/invoke');
            mqttClient.subscribe('stillpi/condenser/ping');
            mqttClient.subscribe('stillpi/condenser/getParams');
            announceCondenserController();
            initCompleted = true;
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
            // console.log(sensors);

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

    initCompleted: function () {
      return initCompleted;
    },

    getSensorUIDs: function () {
      return sensors;
    },

    getTemperature: function (condenser) {
      return sensorTemps[condenser];
    },

    publishMqttMessage: function (topic, message) {
      mqttClient.publish(topic, JSON.stringify(message));
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
    init: async function () {
      console.log('Application starting.');  

      // Initialize the sensor, configuration and valve controllers.  
      config.configController.init();
      sensorController.init();
      while (!sensorController.initCompleted()) {
        console.log("Waiting for sensorController initialization to complete ...");
        await new Promise(r => setTimeout(r, 2000));  // Sleep a little while.  
      };
      valveController.init(global.configProxy.product.valveSetting, global.configProxy.dephleg.valveSetting);
 
      console.log('Application has started.');  
      console.log("Current config object: ", global.configProxy);
    }
}

})(sensorController, mqttController);


controller.init();
