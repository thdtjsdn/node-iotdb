/*
 *  iotdb.js
 *
 *  David Janes
 *  IOTDB.org
 *  2013-12-01
 *
 *  NodeJS IOTDB control
 *
 *  This is also the 'main' for the package
 *
 *  Copyright [2013-2015] [David P. Janes]
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

"use strict";

var timers = require('timers');

var events = require('events');
var util = require('util');
var path = require('path');
var fs = require('fs');

var bunyan = require('bunyan');
var logger = bunyan.createLogger({
    name: 'iotdb',
    module: 'IOT',
});

var things = require('./things');
var thing_array = require('./thing_array');
var cfg = require('./cfg');
var _ = require('./helpers');

var _shutting_down = false;

/**
 *  Manage things, drivers and connections to the
 *  {@link https://iotdb.org/ IOTDB.org} running
 *  in a NodeJS application.
 *
 *  <p>
 *  Usually created as a singleton using iotdb.iot()
 *
 *  @constructor
 */
var IOT = function (initd) {
    var self = this;

    if (exports.instance == null) {
        exports.instance = self;
    }

    self.initd = _.defaults(initd, {
        meta_dir: ".iotdb/meta",
    });

    self._setup_events();
    self._setup_exit();
    self._setup_things();
};
util.inherits(IOT, events.EventEmitter);

IOT.prototype._setup_events = function () {
    var self = this;

    events.EventEmitter.call(self);
    self.setMaxListeners(0);
};

IOT.prototype._setup_exit = function () {
    var self = this;

    process.on('exit', self._exit_cleanup.bind(self, {
        from: 'exit'
    }));
    process.on('SIGINT', self._exit_cleanup.bind(self, {
        from: 'SIGINT',
        exit: true,
        cleanup: true
    }));
};

/**
 *  self._things is the singleton Things manager
 */
IOT.prototype._setup_things = function () {
    var self = this;

    self._things = things.things();

    self.things().on_thing(function (thing) {
        self.emit("thing", thing);
    });
};

IOT.prototype._exit_cleanup = function (paramd, err) {
    var self = this;

    _shutting_down = true;
    logger.info({
        method: "_exit_cleanup",
        paramd: paramd,
        err: err
    }, "start");

    var time_wait = 0;
    if (paramd.cleanup) {
        time_wait = self._things.disconnect();
    }

    if (paramd.exit) {
        if (time_wait === 0) {
            console.log("### calling process.exit(0) - good-bye!");
            process.exit(0);
        } else {
            // console.log("# IOT._exit_cleanup: exiting in", time_wait / 1000.0);
            logger.info({
                method: "_exit_cleanup",
                exiting_in: time_wait / 1000.0
            }, "delaying exit");
            setTimeout(process.exit, time_wait);
        }
    }
};

/**
 *  Return all the Things
 */
IOT.prototype.things = function (model_code) {
    return this._things.things(model_code);
};


/**
 *  Connect to Things. Return a Thing Array
 *  of things thus discovered
 */
IOT.prototype.connect = function (modeld, initd) {
    return this._things.connect(modeld, initd);
};

/**
 *  Connect to Things.
 */
IOT.prototype.discover = function (modeld, initd) {
    this._things.discover(modeld, initd);
    return this;
};

/**
 *  Persist all changes to metadata.
 *  <p>
 *  Tons of work needed here
 */
IOT.prototype.meta_save = function (t) {
    var self = this;

    if (!self.initd.meta_dir) {
        logger.error({
            method: "meta_save"
        }, "no initd.meta_dir");
        return;
    }

    var meta_dir = cfg.cfg_expand(self.envd, self.initd.meta_dir);
    try {
        fs.mkdirSync(meta_dir);
    } catch (err) {}

    var _persist = function (thing) {
        if (!thing) {
            return;
        }

        var meta = thing.meta();
        if (_.isEmpty(meta.updated)) {
            return;
        }

        var thing_id = thing.thing_id();
        var file_meta = path.join(meta_dir, thing_id.replace(/^.*:/, '') + ".json");
        fs.writeFileSync(file_meta, JSON.stringify(meta.updated, null, 2) + "\n");

        logger.error({
            method: "meta_save",
            file: file_meta,
            thing_id: thing_id,
        }, "no initd.meta_dir");
    };

    if (t) {
        _persist(t);
    } else {
        for (var thing_id in self.thing_instanced) {
            _persist(self.thing_instanced[thing_id]);
        }
    }
};

/*
 *  API
 */
exports.IOT = IOT;
exports.shutting_down = function () {
    return _shutting_down;
};

exports.attribute = require('./attribute');
for (var key in exports.attribute) {
    exports[key] = exports.attribute[key];
}

exports.definitions = require('./definitions');
for (var key in exports.definitions.attribute) {
    exports[key] = exports.definitions.attribute[key];
}

exports.model = require('./model');
exports.make_model = exports.model.make_model;
exports.Queue = require('./queue').FIFOQueue;
exports.helpers = _;
exports._ = _;
exports.cfg = cfg;
exports.bunyan = bunyan;
exports.logger = function() {
    return bunyan.createLogger.apply(bunyan.createLogger, arguments);
};

var bridge_wrapper = require('./bridge_wrapper');
exports.bridge_wrapper = bridge_wrapper.bridge_wrapper;
exports.make_wrap = bridge_wrapper.make_wrap;

var keystore = require('./keystore');
exports.keystore = keystore.keystore;
exports.Keystore = keystore.Keystore;

var transporter = require('./transporter');
exports.transport = transporter.transport;

var modules = require('./modules');
exports.modules = modules.modules;
exports.Modules = modules.Modules;
exports.module = function(name) {
    var m = modules.modules().module(name);
    if (m) {
        return m;
    }

    if (name === 'bunyan') {
        return bunyan;
    }

    return require(name);
};

/**
 *  Singleton
 */
exports.instance = null;

exports.iot = function (paramd) {
    if (exports.instance == null) {
        exports.instance = new IOT(paramd);
    }

    return exports.instance;
};
