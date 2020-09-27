
var jsonfile = require('jsonfile');
const configFilename = "/home/pi/condenserController/configuration/config.json";

// START CONFIGURATION CONTROLLER
    /*
        Configuration object:
            {
                “product”:
                    {
                    “state”: “on”,                // String: “on”, ”off”
                    “mode”: “manual”,     // String: “manual”, ”auto”
                    “valveSetting”: 10,     // Integer: 0 – 100
                    “targetTemp”: 125     // Integer: 0 – 210
                    },
                “dephleg”:
                    {
                    “state”: “on”,                // String: “on”, ”off”
                    “mode”: “manual”,     // String: “manual”, ”auto”
                    “valveSetting”: 10,     // Integer: 0 – 100
                    “targetTemp”: 125     // Integer: 0 – 210
                    }
            }

    */


// Values assigned here are the default values.  If a config file exists, these values are over-written with the file contents.
global.config = {};

var fileSaveInterval = 60;   // In seconds.  


// Based on this example:
//      https://botproxy.net/docs/how-to/how-to-use-javascript-proxy-for-nested-objects/
let configProxyHandler = {
    get(target, key) {
        // console.log('Access config: ', key, '  ', target);
        if (typeof target[key] === 'object' && target[key] !== null) {
            return new Proxy(target[key], configProxyHandler)
        } else {
            return target[key];
        }
    },
    set (target, key, value) {
        // Update the target data.  
        target[key] = value;

        // Save config to permanent storage
        // saveConfig();

        return true
    }
  }

global.configProxy = new Proxy(config, configProxyHandler);



var readConfig = function () {

    global.config = jsonfile.readFileSync(configFilename);
};

var saveConfig = function () {
    
    // console.log('Saving config');
    // console.log('Saving config: ', global.config);
    jsonfile.writeFile(configFilename, global.config, function (err) {
        if (err === null) {
            // console.error('Saving config succeeded.');
        } else {
            // console.error('Saving config failed: ', err);
        }
    });
};



var configController = (function () {

    return {
        init: function () {
            console.log('Initializing configController');

            // Check if a configuration file exists
            var fs = require('fs');
            console.log("Configuration filename: ", configFilename, "  ", fs.existsSync(configFilename));
            if (fs.existsSync(configFilename)) {
                console.log('Configuration file exists.');
                readConfig();
                configProxy = new Proxy(config, configProxyHandler);
            } else {
                console.log('Configuration file DOES NOT exist.');
                // Initialize the configuration object with default values.  
                config = {
                    product:
                        {
                        state: 'off',                // String: “on”, ”off”
                        mode: 'auto',     // String: “manual”, ”auto”
                        valveSetting: 10,     // Integer: 0 – 100
                        targetTemp: 125     // Integer: 0 – 210
                        },
                    dephleg:
                        {
                            state: 'off',                // String: “on”, ”off”
                            mode: 'auto',     // String: “manual”, ”auto”
                            valveSetting: 10,     // Integer: 0 – 100
                            targetTemp: 125     // Integer: 0 – 210
                        }
                }
                
                console.log('config: ', config);
                configProxy = new Proxy(config, configProxyHandler);

                // Save the default configuration.  
                saveConfig();
            }

            // Setup a periodic saving of the configuration.  
            var intervalID = setInterval( function() {
                saveConfig();
            }, fileSaveInterval * 1000);
        },

        saveConfig: function () {
            saveConfig();
        },
    }
    module.exports = {configProxy};
})();

// END CONFIGURATION CONTROLLER

module.exports = {configProxy, configController};