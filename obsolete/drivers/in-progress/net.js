/*
 *  drivers/net.js
 *
 *  David Janes
 *  IOTDB.org
 *  2014-03-06
 *
 *  Connect by pinging Nets
 *
 *  Copyright [2013-2014] [David P. Janes]
 *  
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *  
 *     http://www.apache.org/licenses/LICENSE-2.0
 *  
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

"use strict"

var _ = require("../helpers");
var driver = require('../driver')
var FIFOQueue = require('../queue').FIFOQueue
var unirest = require('unirest');

var queue = new FIFOQueue("Net");

/**
 */
var Net = function(paramd) {
    var self = this;
    driver.Driver.prototype.driver_construct.call(self);

    paramd = _.defaults(paramd, {
        verbose: false,
        driver: "iot-driver:net",
        initd: {}
    })

    self.verbose = paramd.verbose;
    self.driver = _.expand(paramd.driver)

    return self;
}

Net.prototype = new driver.Driver;

/* --- class methods --- */

Net.prototype._init = function(initd) {
    var self = this;

    if (!initd) {
        return;
    }

    if (initd.iri) {
        self.iri = initd.iri;
    }
}

/**
 *  See {@link Driver#identity Driver.identity}
 */
Net.prototype.identity = function(kitchen_sink) {
    var self = this;

    if (self.__identityd === undefined) {
        var identityd = {}
        identityd["driver"] = self.driver

        // once the driver is 'setup' this will have a value
        if (self.iri) {
            identityd["iri"] = self.iri
        }

        _.thing_id(identityd);
        
        self.__identityd = identityd;
    }

    return self.__identityd;
}

/**
 *  See {@link Driver#setup Driver.setup}
 */
Net.prototype.setup = function(paramd) {
    var self = this;

    /* chain */
    driver.Driver.prototype.setup.call(self, paramd);

    if (paramd) {
        self._init(paramd.initd)
    }

    return self;
}

/**
 *  See {@link Driver#discover Driver.discover}
 */
Net.prototype.discover = function(paramd, discover_callback) {
    if (paramd.initd === undefined) {
        console.log("# NetDriver.discover: no nearby discovery (not a problem)")
        return
    }

    discover_callback(new Net());
}

/**
 *  Just send the data via PUT to the API
 *  <p>
 *  See {@link Driver#push Driver.push}
 */
Net.prototype.push = function(paramd) {
    var self = this;

    console.log("- Net.push", 
        "\n  iri", self.iri, 
        "\n  driverd", paramd.driverd, 
        "\n  initd", paramd.initd)

    var qitem = {
        id: self.light,
        run: function() {
            unirest
                .get(self.iri)
                .query(paramd.driverd)
                // .headers({'Accept': 'application/json'})
                .end(function(result) {
                    queue.finished(qitem);
                    if (!result.ok) {
                        console.log("# Net.push/.end", "not ok", "url", self.iri, "result", result.text);
                        return
                    }

                    console.log("- Net.push/.end.body", result.body);
                })
            ;
        }
    }
    queue.add(qitem);

    return self;
}

/**
 *  Request the Driver's current state. It should
 *  be called back with <code>callback</code>
 *  <p>
 *  See {@link Driver#pull Driver.pull}
 */
Net.prototype.pull = function() {
    var self = this;

    console.log("- Net.pull", 
        "\n  iri", self.iri, 
        "\n  initd", paramd.initd
    )

    return self;
}


/*
 *  API
 */
exports.Driver = Net
