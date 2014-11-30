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

"use strict";

var timers = require('timers');

var crypto = require('crypto');
var events = require('events');
var util = require('util');
var path = require('path');
var fs = require('fs');
var unirest = require('unirest');
var assert = require('assert');
var node_url = require('url');

var bunyan = require('bunyan');
var logger = bunyan.createLogger({
    name: 'iotdb',
    module: 'IOT',
});

var graph = require('./graph');
var thing_array = require('./thing_array');
var libs = require('./libs/libs');
var cfg = require('./cfg');
var _ = require('./helpers');
var Interaction = require('./interaction').Interaction;

var EVENT_NEW_THING = "iot_new_thing";
var EVENT_REGISTER_MODEL = "iot_register_thing";
var EVENT_REGISTER_BRIDGE = "iot_register_driver";

// internal
var EVENT_ON_READY = "iot_ready";
var EVENT_ON_REGISTER_DRIVERS = "iot_on_register_drivers";
var EVENT_ON_REGISTER_STORES = "iot_on_register_stores";
var EVENT_ON_REGISTER_TRANSMOGRIFIERS = "iot_on_register_transmogrifiers";
var EVENT_ON_REGISTER_MODELS = "iot_on_register_models";
var EVENT_ON_REGISTER_THINGS = "iot_on_register_things";
var EVENT_ON_READY_CHANGE = "iot_ready_change";

/**
 *  Singleton
 */
exports.instance = null;

/**
 *  Manage things, drivers and connections to the
 *  {@link https://iotdb.org/ IOTDB.org} running
 *  in a NodeJS application.
 *
 *  <p>
 *  This is the low level version. More likely you want
 *  to work with {@link IOTDB}
 *
 *  <p>
 *  Usually created as a singleton, but this is not required
 *
 *  @constructor
 */
var IOT = function (initd) {
    var self = this;

    if (exports.instance == null) {
        exports.instance = self;
    }

    self.configure(initd);
};
util.inherits(IOT, events.EventEmitter);

/**
 */
exports.iot = function (paramd) {
    if (exports.instance == null) {
        paramd = _.defaults(paramd, {
            load_models: true,
            load_things: true,
            load_drivers: true,
            load_stores: true,
            load_transmogrifiers: true,
            iotdb_thing_get: false,
            iotdb_thing_create: false,
            show_health: true,

            end: null
        });
        new IOT(paramd);
    }

    return exports.instance;
};

/**
 *  This handles all the setup for clases IOT and IOTDB.
 *  It is automatically called and it seems unlikely
 *  you will ever have to call it.
 *
 *  @param {dict} initd
 *  Initialization data. Quite a few things here, will
 *  be documented elsewhere
 */
IOT.prototype.configure = function (paramd) {
    var self = this;

    events.EventEmitter.call(self);

    self.cfg_load_paramd(paramd);
    self.setMaxListeners(self.initd.max_listeners);

    self.readyd = {};
    self.ready_once = false;
    self.ready_delta('graph_ready', 1);
    self.ready_delta('oauthd', 1);
    self.ready_delta('keystored', 1);
    self.ready_delta('configure', 1);
    self.ready_delta('on_register_drivers', 1);
    self.ready_delta('load_drivers', 1);

    self.ready_delta('on_register_transmogrifiers', 1);
    self.ready_delta('load_transmogrifiers', 1);

    self.ready_delta('on_register_models', 1);
    self.ready_delta('load_models', 1);

    self.ready_delta('on_register_things', 1);
    self.ready_delta('load_things', 1);

    self.ready_delta('on_register_stores', 1);
    self.ready_delta('load_stores', 1);

    self.ready_delta('iotdb_thing_get', 1);
    self.ready_delta('iotdb_places_get', 1);

    self.ready_delta('load_meta', 1);

    self.username = self.initd.username;
    self.cfg_root = self.initd.cfg_root;
    self.shutting_down = false;

    self.iotdb_prefix = self.initd.iotdb_prefix;
    self.iotdb_oauthd = {};

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = self.initd.NODE_TLS_REJECT_UNAUTHORIZED;

    self.gm = new graph.GraphManager(self);
    self.gm.wire();
    self.ready_delta('graph_ready', -1);

    self.driver_exemplars = [];
    self.model_exemplard = {};
    self.thing_instanced = {};
    self.store_instanced = {};
    self.transmogrifier_classd = {};
    self.issueds = [];

    self.cfg_load_oauth();
    self.cfg_load_keystore();
    self._check_requirements();

    self.ready_delta('on_register_drivers', -1);
    self.ready_delta('load_drivers', -1);
    self.ready_delta('on_register_stores', -1);
    self.ready_delta('load_stores', -1);
    self.ready_delta('on_register_models', -1);
    self.ready_delta('load_models', -1);
    self.ready_delta('on_register_things', -1);
    self.ready_delta('load_things', -1);
    self.ready_delta('on_register_transmogrifiers', -1);
    self.ready_delta('load_transmogrifiers', -1);
    self.ready_delta('iotdb_thing_get', -1);
    self.ready_delta('iotdb_places_get', -1);
    self.ready_delta('load_meta', -1);
    self.ready_delta('configure', -1);

    /* cleanup code */
    process.on('exit', self._exit_cleanup.bind(self, {
        from: 'exit'
    }));
    process.on('SIGINT', self._exit_cleanup.bind(self, {
        from: 'SIGINT',
        exit: true,
        cleanup: true
    }));
    // process.on('uncaughtException', self._exit_cleanup.bind(self, {from:'exception',exit:true,cleanup:true}));
};

IOT.prototype._exit_cleanup = function (paramd, err) {
    var self = this;

    self.shutting_down = true;
    // console.log("- IOT._exit_cleanup", paramd, err);
    logger.info({
        method: "_exit_cleanup",
        paramd: paramd,
        err: err
    }, "start");

    var time_wait = 0;
    if (paramd.cleanup) {
        for (var tid in self.thing_instanced) {
            var thing = self.thing_instanced[tid];
            if (!thing || !thing.driver_instance) {
                continue;
            }

            var driver_instance = thing.driver_instance;
            thing.driver_instance = null;

            var time_needed = driver_instance.shutdown();
            time_wait = Math.max(time_wait, time_needed);
        }
    }

    if (paramd.exit) {
        if (time_wait === 0) {
            console.log("CALL EXIT");
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
 *  Load the params
 *
 *  Kinda complicated but it makes sense if you
 *  look at it long enough
 */
IOT.prototype.cfg_load_paramd = function (initd) {
    var self = this;

    initd = _.defaults(initd, {
        envd: {},
        cfg_path: [
            "$IOTDB_PROJECT/.iotdb",
            "$IOTDB_CFG"
        ]
    });

    self.envd = cfg.cfg_envd(initd.envd);

    var filenames = cfg.cfg_find(self.envd, initd.cfg_path, "iotdb.json");
    cfg.cfg_load_json(filenames, function (paramd) {
        if (paramd.error) {
            // console.log("# IOT.cfg_load_paramd:", paramd.error, paramd.exception);
            logger.error({
                method: "cfg_load_paramd",
                cause: "likely user hasn't added iotdb.json using 'iotdb'",
                filename: paramd.filename,
                error: paramd.error,
                exception: paramd.exception,
            }, "error loading JSON iotdb.json");
            return;
        }

        initd = _.defaults(initd, paramd.doc);
    });

    // backward compatibility
    for (var auto_key in initd) {
        if (!auto_key.match(/^auto_/)) {
            continue;
        }

        var new_key = auto_key.substring(5);
        if (initd[new_key] === undefined) {
            initd[new_key] = initd[auto_key];
        }

        initd[auto_key] = undefined;
    }

    self.initd = _.defaults(initd, {
        username: "$IOTDB_USER",
        cfg_root: path.join(process.env['HOME'], ".iotdb"),
        iotdb_prefix: "https://iotdb.org",

        max_listeners: 1024,
        envd: {},

        cfg_path: [
            "$IOTDB_PROJECT/.iotdb",
            "$IOTDB_CFG",
        ],
        drivers_path: [
            "$IOTDB_INSTALL/drivers"
        ],
        stores_path: [
            "$IOTDB_INSTALL/stores"
        ],
        transmogrifiers_path: [
            "$IOTDB_INSTALL/transmogrifiers"
        ],
        models_modules: [
            "iotdb-models"
        ],
        models_path: [
            "$IOTDB_PROJECT/models"
        ],
        things_path: [
            "$IOTDB_PROJECT/things"
        ],
        meta_dir: "$IOTDB_PROJECT/.iotdb/meta",

        discover: false,
        load_drivers: false,
        load_stores: false,
        load_transmogrifiers: false,
        load_models: false,
        load_things: false,
        iotdb_places_get: false,
        iotdb_thing_get: false,
        iotdb_thing_create: false,
        show_health: false,

        require_username: false,
        require_iotdb_ouath: false,

        NODE_TLS_REJECT_UNAUTHORIZED: "0"
    });

    self.initd.username = cfg.cfg_expand(self.envd, self.initd.username);
};

/**
 *  Load the keystore settings
 *
 *  @protected
 */
IOT.prototype.cfg_load_keystore = function () {
    var self = this;

    self.keystored = {};

    // load all the oauth files - priority is given to first found
    var filenames = cfg.cfg_find(self.envd, self.initd.cfg_path, "keystore.json");
    filenames.reverse();

    cfg.cfg_load_json(filenames, function (paramd) {
        if (paramd.error) {
            // console.log("# IOT.cfg_load_oauth:", paramd.error, paramd.exception);
            logger.error({
                method: "cfg_load_keystore",
                cause: "likely user hasn't added keystore.json using 'iotdb' - not serious",
                filename: paramd.filename,
                error: paramd.error,
                exception: paramd.exception,
            }, "error loading JSON keystore.json");
            return;
        }

        _.smart_extend(self.keystored, paramd.doc);
    });

    self.ready_delta('keystored', -1);
};

/**
 *  Get a value from the Keystore
 */
IOT.prototype.cfg_get = function (key, otherwise) {
    var self = this;

    var d = self.keystored;
    var subkeys = key.split('/');
    var lastkey = subkeys[subkeys.length - 1];

    for (var ski = 0; ski < subkeys.length - 1; ski++) {
        var subkey = subkeys[ski];
        var subd = d[subkey];
        if (subd === undefined) {
            return otherwise;
        } else if (_.isObject(subd)) {
            d = subd;
        } else {
            return otherwise;
        }
    }

    var value = d[lastkey];
    if (value === undefined) {
        return otherwise;
    }

    return value;

    /*
    var value = self.keystored[key];
    if (value === undefined) {
        return otherwise;
    } else {
        return value;
    }
    */
};

/**
 *  Set a value from the Keystore
 *  <br />
 *  NOT PERSISTENT!
 */
IOT.prototype.cfg_set = function (key, value) {
    var self = this;
    self.keystored[key] = value;
};

/**
 *  Load the OAuth settings
 *
 *  @protected
 */
IOT.prototype.cfg_load_oauth = function () {
    var self = this;

    self.oauthdd = {};
    self.iotdb_oauthd = {};

    // load all the oauth files - priority is given to first found
    var filenames = cfg.cfg_find(self.envd, self.initd.cfg_path, "oauth.json");
    cfg.cfg_load_json(filenames, function (paramd) {
        if (paramd.error) {
            // console.log("# IOT.cfg_load_oauth:", paramd.error, paramd.exception);
            logger.error({
                method: "cfg_load_oauth",
                cause: "likely user hasn't added oauth.json using 'iotdb' - not serious",
                filename: paramd.filename,
                error: paramd.error,
                exception: paramd.exception,
            }, "error loading JSON OAuth");
            return;
        }

        for (var api_location in paramd.doc) {
            if (self.oauthdd[api_location]) {
                continue;
            }

            self.oauthdd[api_location] = paramd.doc[api_location];
        }
    });

    // get the specific value for iotdb_prefix
    self.iotdb_oauth_key = self.username.toLowerCase() + "@" + node_url.parse(self.initd.iotdb_prefix).host;
    self.iotdb_oauthd = self.oauthdd[self.iotdb_oauth_key];
    if (_.isEmpty(self.iotdb_oauthd)) {
        // console.log("# IOT.cfg_load_oauth: no IOTDB OAuth info", "\n  username", self.iotdb_oauth_key);
        logger.error({
            method: "cfg_load_oauth",
            cause: "likely user hasn't added oauth.json using 'iotdb' - not serious",
            oauth_key: self.iotdb_oauth_key
        }, "no IOTDB OAuth Info");
    } else {
        // console.log("- IOT.cfg_load_oauth: IOTDB OAuth info discovered");
        logger.debug("IOTDB OAuth info discovered");
        self.iotdb_oauthd = {};
    }

    self.ready_delta('oauthd', -1);
};


/**
 *  Return the oauth dictionary for the 'iri'.
 *  The result is based on the host of the iri
 */
IOT.prototype.cfg_get_oauthd = function (iri, otherwise) {
    var self = this;

    var api_location = node_url.parse(iri).host;
    var oauthd = self.oauthdd[api_location];

    return oauthd ? oauthd : otherwise;
};

/**
 *  Check paramd.require_*
 *
 *  @protected
 */
IOT.prototype._check_requirements = function () {
    var self = this;
    var interaction;

    if ((self.username === null) ||
        (self.username === "") ||
        (self.username === undefined) ||
        (self.username === "nobody")) {
        if (self.initd.require_username) {
            throw new Error("IOT._check_requirements: FAIL: require_username");
        } else {
            interaction = new Interaction();

            interaction.header("IOT._check_requirements: no iot.username");
            interaction.log("- this is highly recommended (but not required");
            interaction.log("- run this command");
            interaction.log();
            interaction.code("iotdb iotdb-oauth --global");
            interaction.end();

            self.report_issue({
                section: "iotdb",
                name: "username",
                message: "set with $ iotdb iotdb-oauth --global"
            });
        }
    }

    if (!self.keystored.machine_id) {
        interaction = new Interaction();

        interaction.header("IOT._check_requirements: no 'machine_id'");
        interaction.log("- this is highly recommended, but only required for some drivers");
        interaction.log("- run this command");
        interaction.log();
        interaction.code("iotdb machine-id");
        interaction.end();

        self.report_issue({
            section: "iotdb",
            name: "machine_id",
            message: "set with $ iotdb machine-id"
        });
    }

    if (self.initd.require_iotdb_oauth) {
        if (_.isEmpty(self.iotdb_oauthd)) {
            /*
            console.log("# IOT._check_requrements",
                "\n  username", self.username,
                "\n  iotdb_prefix", self.iotdb_prefix,
                "\n  iotdb_oauth_key", self.iotdb_oauth_key
            )
             */
            logger.fatal({
                method: "_check_requirements",
                cause: "likely user hasn't added oauth.json using iotdb - SERIOUS because required",
                "username": self.username,
                "iotdb_prefix": self.iotdb_prefix,
                "iotdb_oauth_key": self.iotdb_oauth_key
            }, "unexpected empty iotdb_oauthd");
            throw new Error("IOT._check_requirements: FAIL: require_iotdb_oauth");
        }
    }
};

/**
 *  Django(-ish) string formatting. Can take
 *  multiple dictionaries as arguments, priority
 *  given to the first argument seen.
 *
 *  <p>
 *  The dictionary { cfg: self.keystored } is
 *  always inserted at the end
 */
IOT.prototype.format = function () {
    var self = this;

    var av = [];

    // the format
    av.push(arguments[0]);

    // arguments, converting Things into their state dictionary
    for (var ai = 1; ai < arguments.length; ai++) {
        var a = arguments[ai];
        if (a.__is_thing) {
            av.push(a.state());
        } else {
            av.push(a);
        }
    }

    // our keystore
    av.push({
        cfg: self.keystored,
    });

    return _.format.apply(_, av);
};

/**
 *  Tracks of things that have to be ready before this object is ready.
 *  When everything is ready, we send an EVENT_ON_READY event
 *
 *  @protected
 */
IOT.prototype.ready_delta = function (key, delta) {
    var self = this;

    var value = self.readyd[key];
    value = value ? value : 0;
    value += delta;
    self.readyd[key] = value;

    if (value < 0) {
        // console.log("#IOT.ready_delta", "serious error - over decremented", key);
        logger.fatal({
            method: "ready_delta",
            cause: "Node-IOTDB error - contact us",
            key: key
        }, "serious error - over decremented");
        throw new Error("impossible state error");
    } else if (value > 0) {
        return;
    } else {
        if (key === 'on_register_drivers') {
            self.emit(EVENT_ON_REGISTER_DRIVERS);
        }
        if ((key === 'load_drivers') && self.initd.load_drivers) {
            self._load_drivers();
        }
        if (key === 'on_register_stores') {
            self.emit(EVENT_ON_REGISTER_STORES);
        }
        if (key === 'on_register_transmogrifiers') {
            self.emit(EVENT_ON_REGISTER_TRANSMOGRIFIERS);
        }
        if ((key === 'load_stores') && self.initd.load_stores) {
            self._load_stores();
        }
        if ((key === 'load_transmogrifiers') && self.initd.load_transmogrifiers) {
            self._load_transmogrifiers();
        }
        if (key === 'on_register_models') {
            self.emit(EVENT_ON_REGISTER_MODELS);
        }
        if (key === 'on_register_things') {
            self.emit(EVENT_ON_REGISTER_THINGS);
        }
        if ((key === 'load_models') && self.initd.load_models) {
            self._load_model_modules();
            self._load_models();
        }
        if ((key === 'load_things') && self.initd.load_things) {
            self._load_things();
        }
        if ((key === 'iotdb_thing_get') && self.initd.iotdb_thing_get) {
            self._iotdb_thing_get();
        }
        if ((key === 'iotdb_places_get') && self.initd.iotdb_places_get) {
            self.iotdb_places_get();
        }

        if (self.is_ready()) {
            if (!self.__ready_once) {
                // console.log("- IOT.on_ready: READY!");
                logger.info({
                    method: "on_ready"
                }, "READY!");
                self.__ready_once = true;

                if (self.initd.show_health) {
                    self.health();
                }
            }
            self.emit(EVENT_ON_READY);

            if (self.initd.discover) {
                if (self._auto_discovered) {
                    return;
                }

                self.connect();
            }
        }
    }

    // the ready state changed
    self.emit(EVENT_ON_READY_CHANGE, key);
};

/**
 *  Are we ready?
 *
 *  @protected
 */
IOT.prototype.is_ready = function () {
    var self = this;

    for (var key in self.readyd) {
        if (self.readyd[key]) {
            return false;
        }
    }

    return true;
};

/**
 *  Callback when IOTDB is ready. This can be
 *  immediately or later, depending
 *  <p>
 *  Use this function!
 */
IOT.prototype.on_ready = function (callback) {
    var self = this;

    var doit = function () {
        if (callback) {
            callback();
        }

        callback = null;
    };

    if (self.is_ready()) {
        doit();
    } else {
        self.on(EVENT_ON_READY, doit);
    }
};

IOT.prototype.on_register_drivers = function (callback) {
    var self = this;

    var doit = function () {
        if (callback) {
            try {
                self.ready_delta('graph_ready', 1);
                callback();
            } finally {
                self.ready_delta('graph_ready', -1);
            }
        }

        callback = null;
    };

    if (self.readyd['on_register_drivers'] === 0) {
        doit();
    } else {
        self.on(EVENT_ON_REGISTER_DRIVERS, doit);
    }
};

IOT.prototype.on_register_stores = function (callback) {
    var self = this;

    var doit = function () {
        if (callback) {
            try {
                self.ready_delta('graph_ready', 1);
                callback();
            } finally {
                self.ready_delta('graph_ready', -1);
            }
        }

        callback = null;
    };

    if (self.readyd['on_register_stores'] === 0) {
        doit();
    } else {
        self.on(EVENT_ON_REGISTER_STORES, doit);
    }
};

IOT.prototype.on_register_transmogrifiers = function (callback) {
    var self = this;

    var doit = function () {
        if (callback) {
            try {
                self.ready_delta('graph_ready', 1);
                callback();
            } finally {
                self.ready_delta('graph_ready', -1);
            }
        }

        callback = null;
    };

    if (self.readyd['on_register_transmogrifiers'] === 0) {
        doit();
    } else {
        self.on(EVENT_ON_REGISTER_TRANSMOGRIFIERS, doit);
    }
};

IOT.prototype.on_register_models = function (callback) {
    var self = this;

    var doit = function () {
        if (callback) {
            try {
                self.ready_delta('graph_ready', 1);
                callback();
            } finally {
                self.ready_delta('graph_ready', -1);
            }
        }

        callback = null;
    };

    if (self.readyd['on_register_models'] === 0) {
        doit();
    } else {
        self.on(EVENT_ON_REGISTER_MODELS, doit);
    }
};

IOT.prototype.on_register_things = function (callback) {
    var self = this;

    var doit = function () {
        if (callback) {
            callback();
        }

        callback = null;
    };

    if (self.readyd['on_register_things'] === 0) {
        doit();
    } else {
        self.on(EVENT_ON_REGISTER_THINGS, doit);
    }
};

IOT.prototype.on_graph_ready = function (callback) {
    var self = this;

    if (self.readyd['graph_ready'] === 0) {
        callback();
    } else {
        self.on(EVENT_ON_READY_CHANGE, function (key) {
            if (key === 'graph_ready') {
                callback();
            }
        });
    }
};

/**
 *  Callback when IOTDB finds new Things
 */
IOT.prototype.on_thing = function (callback) {
    var self = this;

    self.on(EVENT_NEW_THING, callback);

    // check for already registered things
    for (var ti in self.thing_instanced) {
        var thing = self.thing_instanced[ti];
        if (!thing) {
            continue;
        }

        callback(thing);
    }
};

/**
 *  Callback when IOTDB finds new Things with a particular Model
 */
IOT.prototype.on_thing_with_model = function (model, callback) {
    var self = this;

    var modeld = {};
    self._clarify_model(modeld, model);

    self.on(EVENT_NEW_THING, function (thing) {
        if (thing.code === modeld.model_code) {
            callback(thing);
        }
    });

    // check for already registered things
    for (var ti in self.thing_instanced) {
        var thing = self.thing_instanced[ti];
        if (!thing) {
            continue;
        }

        if (thing.code === modeld.model_code) {
            callback(thing);
        }
    }
};

/**
 *  Callback when IOTDB finds new Things with a particular tag
 */
IOT.prototype.on_thing_with_tag = function (tag, callback) {
    var self = this;

    self.on(EVENT_NEW_THING, function (iot, thing) {
        if (thing.has_tag(tag)) {
            callback(thing);
        }
    });

    // check for already registered things
    for (var ti in self.thing_instanced) {
        var thing = self.thing_instanced[ti];
        if (!thing) {
            continue;
        }
        if (thing.has_tag(tag)) {
            callback(thing);
        }
    }
};

/**
 *  Return the path for a configuration file
 */
IOT.prototype.cfg = function (name) {
    return path.join(this.cfg_root, name);
};

/**
 *  Register a Thing exemplar. These are used
 *  to connect Things with {@link Driver Drivers}
 *
 *  @param {Thing} model_exemplar
 *
 *  @return {this};
 */
IOT.prototype.register_model = function (model) {
    var self = this;

    var thing = new model();
    self.model_exemplard[thing.code] = thing;
    self.emit(EVENT_REGISTER_MODEL, thing);

    return self;
};

/**
 *  Register a {@link Driver}.
 *
 *  @param {Driver} driver
 *
 *  @return {this};
 */
IOT.prototype.register_driver = function (driver) {
    var self = this;

    var driver_exemplar = new driver();
    var driver_identity = driver_exemplar.identity();
    if (!driver_identity.driver) {
        /*
        console.log("# IOT.register_driver",
            "ignoring driver - no identity", 
            driver_exemplar.constructor.name)
         */
        logger.error({
            method: "register_driver",
            cause: "likely <Driver>.js is not set up correctly",
            driver: driver_exemplar.constructor.name
        }, "ignoring Driver - no identity");
        return;
    }

    if (self.initd.drivers_disabled) {
        var name = _.compact(driver_identity.driver);
        var x = self.initd.drivers_disabled.indexOf(name);
        if (x !== -1) {
            /*
            console.log("# IOT.register_driver",
                "ignoring driver - disabled in iotdb.json (use iotdb to change)", 
                "\n  driver:", name)
            */
            logger.error({
                method: "register_driver",
                cause: "disabled in iotdb.json (use iotdb to change)",
                driver: name
            }, "ignoring Driver - disabled");
            return;
        }
    }

    driver_exemplar.register(self);

    self.driver_exemplars.push(driver_exemplar);
    self.emit(EVENT_REGISTER_BRIDGE, driver_exemplar);

    return self;
};

/**
 *  Register a {@link Store}.
 *
 *  @param {Driver} store
 *
 *  @return {this}
 */
IOT.prototype.register_store = function (store_class) {
    var self = this;

    self.store_instanced[_.expand(store_class.prototype.store_id, "iot-store:")] = new store_class();
    // console.log("- IOT.register_store:", store_class.prototype.store_id);
    logger.info({
        method: "register_store",
        store_id: store_class.prototype.store_id
    }, "registered store");

    return self;
};

/**
 *  Return the store with the given name
 */
IOT.prototype.store = function (store_id) {
    var self = this;

    var store = self.store_instanced[_.expand(store_id, "iot-store:")];
    if (!store) {
        // console.log("# IOT.store", "store not found", store_id);
        logger.error({
            method: "store",
            store_id: store_id
        }, "store not found");
    }

    return store;
};

/**
 *  Register a {@link Transmogrifier}.
 *  <p>
 *  Internals note: we'll probably want to move
 *  this to an exemplar based system
 *
 *  @param {Driver} transmogrifier
 *
 *  @return {this}
 */
IOT.prototype.register_transmogrifier = function (transmogrifier_class) {
    var self = this;

    self.transmogrifier_classd[_.expand(transmogrifier_class.prototype.transmogrifier_id, "iot-transmogrifier:")] = transmogrifier_class;
    // console.log("- IOT.register_transmogrifier:", transmogrifier_class.prototype.transmogrifier_id);
    logger.info({
        method: "register_transmogrifier",
        transmogrifier_id: transmogrifier_class.prototype.transmogrifier_id
    }, "registered transmogrifier");

    return self;
};

/**
 *  Return the transmogrifier with the given name
 */
IOT.prototype.transmogrifier = function (transmogrifier_id, initd) {
    var self = this;

    var transmogrifier = self.transmogrifier_classd[_.expand(transmogrifier_id, "iot-transmogrifier:")];
    if (!transmogrifier) {
        // console.log("# IOT.transmogrifier", "transmogrifier not found", transmogrifier_id);
        logger.error({
            method: "transmogrifier",
            transmogrifier_id: transmogrifier_id
        }, "transmogrifier not found");
    }

    return new transmogrifier(initd);
};

/**
 *  Very important function! This kicks off the work
 *  of Things finding Drivers and Drivers finding Things.
 *  <p>
 *  If called with no arguments, all the registered Drivers
 *  are asked to find things in whatever way they know
 *  how (for example: UPnP does a UPnP LAN search, SmartThings
 *  polls the SmartThings API, Bluetooth Low Energy starts
 *  a device scan, and so forth
 *  <p>
 *  If called with a single IRI argument, we assume this is
 *  a Driver IRI and ask only that Driver (if it exists)
 *  to discover things. See {@link IOT#_discover_nearby}
 *  <p>
 *  If called with Thing (AKA a Model Exemplar), it will try
 *  to discover that Model. There's certain circumstances
 *  that multiple Things may be discovered (for example
 *  with MQTT).
 *  See @{link IOT#_discover_thing}
 *  <p>
 *  If called with a dictionary, we assume it's bind description
 *  with expected elements <code>model</code> and <code>initd</code>.
 *  See @{link IOT#_discover_bind}
 *
 *  @protected
 */
IOT.prototype._discover = function () {
    var self = this;

    var thing_exemplar = null;
    var driver_identityd = null;
    var thing_bindd = null;
    var av = Array.prototype.slice.call(arguments);

    var things;
    if (av.length) {
        var last = av[av.length - 1];
        if (_.isThingArray(last)) {
            things = last;
            av.pop();
        }
    }

    if (av.length) {
        if (_.isString(av[0])) {
            driver_identityd = _.identity_expand(av[0]);
        } else if (_.isModel(av[0])) {
            thing_exemplar = av[0];
        } else if (_.isObject(av[0])) {
            thing_bindd = av[0];
        } else {
            // console.log("# IOT.discover: unexpected argument type", av[0]);
            logger.error({
                method: "discover",
                cause: "likely programmer error",
                argument: av[0]
            }, "unexpected/unknown argument type");
        }
    }

    if (thing_exemplar) {
        return self._discover_thing(thing_exemplar, things);
    } else if (thing_bindd) {
        return self._discover_bind(thing_bindd, things);
    } else {
        logger.fatal({
            method: "fatal",
            cause: "Node-IOTDB error - this code path should be discontinued",
            arguments: arguments,
        }, "we shouldn't be here");
        throw new Error("this code path should be discontinued");

        // return self._discover_nearby(driver_identityd, things);
    }
};


/**
 *  This will ask the registered {@link Drivers} if they
 *  can find devices 'nearby', i.e. on the LAN.
 *
 *  @param {undefined|dictionary} find_driver_identityd
 *  If undefined, do everything. Otherwise use
 *  {@link module:helpers#identity_expand} and look for
 *  matching drivers.
 *
 *  @protected
 */
IOT.prototype._discover_nearby = function (paramd, things) {
    var self = this;
    var any = false;

    paramd = _.defaults(paramd, {});
    if (paramd.driver) {
        paramd.driver = _.expand(paramd.driver, "iot-driver:");
    }

    logger.info({
        method: "_discover_nearby",
        paramd: paramd,
    }, "start");

    var find_driver_identityd = _.identity_expand(paramd.driver);

    for (var bi = 0; bi < self.driver_exemplars.length; bi++) {
        var driver_exemplar = self.driver_exemplars[bi];
        if (find_driver_identityd && !_.identity_overlap(driver_exemplar.identity(), find_driver_identityd)) {
            continue;
        }

        var initd = _.deepCopy(paramd);
        delete initd["driver"];
        delete initd["model"];

        any = true;
        var discover_paramd = {
            nearby: true,
            initd: initd,
        };
        driver_exemplar.discover(discover_paramd, function (driver) {
            if (self.shutting_down) {
                // console.log("# IOT._discover_nearby", "ignoring this Driver because shutting down");
                logger.error({
                    method: "_discover_nearby"
                }, "ignoring this Driver because SHUTTING DOWN");
                driver.disconnect();
                return;
            }

            // see if this driver has already been handled
            var driver_identityd = driver.identity();
            // console.log("- IOT._discover_nearby", "\n  driver.identityd", driver_identityd);
            logger.info({
                method: "_discover_nearby",
                "driver.indentityd": driver_identityd
            }, "this Driver was discovered");

            var existing = self.thing_instanced[driver_identityd.thing_id];
            if (existing) {
                if (existing.reachable()) {
                    // console.log("# IOT._discover_nearby", "thing already exists", driver_identityd.thing_id);
                    logger.error({
                        method: "_discover_nearby",
                        thing_id: driver_identityd.thing_id
                    }, "Thing with thing_id already exists - ignoring");
                    return;
                }
            } else {
                // placeholder
                self.thing_instanced[driver_identityd.thing_id] = null;
            }

            // find a thing to mate with this driver
            var found = false;
            for (var model_code in self.model_exemplard) {
                var model_exemplar = self.model_exemplard[model_code];
                if (!model_exemplar.is_driver_supported(driver)) {
                    continue;
                }

                var thing = model_exemplar.make({
                    initd: model_exemplar.initd
                });
                self._bind_driver(thing, driver);


                found = true;
                self._add_thing(thing, things);

                break;
            }

            if (!found) {
                // console.log("- IOT._discover_nearby", "thing not found", "\n ", "driver_identityd", driver_identityd);
                logger.warn({
                    method: "_discover_nearby",
                    driver_identityd: driver_identityd,
                    cause: "usually OK"
                }, "matching Thing for Driver not found");
            }
        });
    }

    if (!any) {
        logger.error({
            method: "_discover_nearby",
            paramd: paramd,
            cause: "Driver may not be loaded, be available, or exist"
        }, "no matching Driver found");
    }
};

/**
 */
IOT.prototype._add_thing = function (thing, things) {
    var self = this;

    var thing_id = thing.thing_id();
    if (!thing_id) {
        // console.log("# IOT._add_thing", "Thing does not have an identity", thing.initd);
        logger.error({
            method: "_add_thing",
            thing_initd: thing.initd
        }, "Thing does not have an identity");
        return;
    }

    thing.__thing_id = thing_id; // easier for debugging

    var existing = self.thing_instanced[thing_id];
    if (existing) {
        if (existing.reachable()) {
            /*
            console.log("# IOT._add_thing", "Thing has already been registered",
                "\n  thing_id", thing_id,
                "\n  driver_identityd", thing.driver_identityd,
                "\n  initd", thing.initd)
             */
            logger.error({
                method: "_add_thing",
                thing_id: thing_id,
                driver_identityd: thing.driver_identityd,
                initd: thing.initd
            }, "Thing has already been registered");
        } else {
            self._driver_swap(existing, thing);
        }

        return;
    }

    /*
     *  Load file persisted metadata
     *  XXX - this shouldn't happen when talking to IOTDB
     *  for persistence
     *  XXX - this is all horrible
     */
    if (self.initd.meta_dir) {
        var meta_dir = cfg.cfg_expand(self.envd, self.initd.meta_dir);

        var file_meta = path.join(meta_dir, thing_id.replace(/^.*:/, '') + ".json");
        cfg.cfg_load_json([file_meta], function (d) {
            if (d.error) {
                return;
            }

            thing.meta().updated = d.doc;
        });
    }

    /*
     *  Load file
     */
    self.thing_instanced[thing_id] = thing;
    self.emit(EVENT_NEW_THING, thing);

    if (_.isThingArray(things)) {
        things.push(thing);
    }

    thing.pull();

    return true;
};

/**
 */
IOT.prototype._driver_swap = function (existing_thing, new_thing) {
    logger.info({
        method: "_driver_swap",
        driver_identityd: existing_thing.driver_identityd
    }, "swapping the driver");

    if (existing_thing.driver_instance) {
        existing_thing.driver_instance.disconnect();
    }

    existing_thing.driver_instance = new_thing.driver_instance;
    new_thing.driver_instance.thing = existing_thing; // jesus wept

    existing_thing.pull();
    process.nextTick(function () {
        existing_thing.meta_changed();
    });

    new_thing.driver_instance = null;
};

/**
 *  Add a {@link Thing} that's already described (but not
 *  bound to a Driver.
 *  <p>
 *  This is correctly named. If it was <code>discover_model</code>
 *  there would be no expectation that <code>initd</code>
 *  etc. is already filled out
 *
 *  @param {Thing} model_exemplar
 *  Look for a {@link Driver} for this Thing exemplar. If
 *  it is found, {@link Driver#_discover_thing Driver._discover_thing}
 *  is called which will callback with a Driver instance
 *  specifically for this thing. This function then will
 *  create a new Thing from the exemplar and bind them together.
 *
 *  @protected
 */
IOT.prototype._discover_thing = function (thing_exemplar, things) {
    var self = this;

    if (things === undefined) {
        console.trace();
        process.exit(0);
    }

    for (var bi = 0; bi < self.driver_exemplars.length; bi++) {
        var driver_exemplar = self.driver_exemplars[bi];
        if (!thing_exemplar.is_driver_supported(driver_exemplar)) {
            continue;
        }

        var discover_paramd = {
            initd: thing_exemplar.initd
        };
        driver_exemplar.discover(discover_paramd, function (driver) {
            if (self.shutting_down) {
                // console.log("# IOT._discover_thing", "ignoring this Driver because shutting down");
                logger.error({
                    method: "_discover_thing"
                }, "ignoring this Driver because SHUTTING DOWN");
                driver.disconnect();
                return;
            }

            var thing = thing_exemplar.make({
                initd: thing_exemplar.initd
            });

            if (!_.isEmpty(thing_exemplar.initd.driver)) {
                /*
                 *  If a 'driver' is specified, we're _forcing_
                 *  the Thing to go with a particular driver.
                 *  This lets us connect to Things through stores,
                 *  pubnub, etc..
                 */
                self._bind_transport(thing, driver);
            } else {
                self._bind_driver(thing, driver);

                /*
                 *  Has to happen after _bind_driver unfortunately to get the
                 *  right identity. This could definitely be improved.
                 */
                var driver_supported = thing.is_driver_supported(driver, true);
                if (!driver_supported) {
                    // console.log("- IOT._discover_thing", "ignoring this Driver (not a real issue!)");
                    logger.info({
                        method: "_discover_thing",
                        model_code: thing_exemplar.get_code(),
                        thing_initd: thing_exemplar.initd,
                        driver_identityd: driver.identity(),
                    }, "ignoring this Driver instance - not a real issue");

                    thing.driver_instance = null;
                    driver.disconnect();
                    return;
                }
            }

            // console.log("- IOT._discover_thing", "found Driver (bound)");
            logger.debug({
                method: "_discover_thing",
                thing_initd: thing_exemplar.initd,
                driver_identityd: driver.identity()
            }, "found Driver - bound to Thing");

            self._add_thing(thing, things);
            /*
            var driver_identityd = driver.identity();
            var existing = self.thing_instanced[driver_identityd.thing_id];
            if (existing !== undefined) {
                console.log("# IOT._discover_thing: Thing has already been registered",
                    "\n  driver_identity", driver_identityd,
                    "\n  initd", thing_exemplar.initd)
                return;
            }

            self.thing_instanced[driver.identity().thing_id] = thing;

            self.emit(EVENT_NEW_THING, thing);
            */
        });

        // console.log("- IOT._discover_thing", "found Driver (exemplar)");
        logger.info({
            method: "_discover_thing",
            initd: thing_exemplar.initd
        }, "found a Driver exemplar for Thing");
        return self;
    }

    /*
    console.log("# IOT._discover_thing", "NO driver found",
        "\n  thing.driver_identityd=", thing_exemplar.driver_identityd,
        "\n  thing.initd=", thing_exemplar.initd,
        "\n  thing.code=", thing_exemplar.code);
     */
    logger.error({
        method: "_discover_thing",
        thing: {
            driver_identityd: thing_exemplar.driver_identityd,
            initd: thing_exemplar.initd,
            code: thing_exemplar.code,
            cause: "Model is referencing a Driver that Node-IOTDB can't find",
        }
    }, "no Driver exemplar found for this Thing");

    return self;
};

/**
 *  Bind a Model to a Driver.
 *
 *  @param {dictionary} paramd
 *  @param {dictionary|undefined} paramd.driver
 *  The Driver IRI. If not defined, it will be
 *  assumed the IRI of the Model (if available). If no
 *  Driver IRI can be found, we assume it's iot-driver:rest
 *
 *  @param {*} paramd.model
 *  The code of a Model, the IOTDB IRI of a model,
 *  the Model function or a Model exemplar.
 *
 *  @param {dictionary} paramd.initd
 *  The <code>initd</code> data for the Model.
 *
 *  @protected
 */
IOT.prototype._discover_bind = function (paramd, things) {
    var self = this;

    // !!!! - ie we use the paramd as the initd
    var initd = _.deepCopy(paramd);
    delete initd["model"];

    paramd = _.defaults(paramd, {
        initd: initd
    });

    if (paramd.model) {
        self._clarify_model(paramd, paramd.model);
    }

    if (paramd.model_code) {
        paramd.model_code = _.identifier_to_dash_case(paramd.model_code);
    }

    if (paramd.model_code || paramd.model_iri) {
        self.ask_model(paramd, function (callbackd) {
            if (callbackd.error) {
                // console.log("# IOT._discover_bind: Model not found", "\n ", callbackd);
                logger.error({
                    method: "_discover_bind",
                    callbackd: callbackd,
                    model_code: paramd.model_code,
                    model_iri: paramd.model_iri
                }, "Model not found");
            } else if (callbackd.model_exemplar) {
                if (callbackd.model_exemplar.driver_identityd) {
                    paramd = _.defaults(paramd, callbackd.model_exemplar.driver_identityd);
                }
                paramd = _.defaults(paramd, {
                    driver: "iot-driver:rest",
                });

                var thing = callbackd.model_exemplar.make({
                    driver: _.expand(paramd.driver),
                    initd: paramd.initd
                });
                // XXX - THIS SHOULD BE CHANGED to _discover_thing
                self._discover(thing, things);
            } else {
                // console.log("# IOT._discover_bind: unexpected state", callbackd.paramd);
                logger.error({
                    method: "_discover_bind",
                    paramd: callbackd.paramd
                }, "unexpected state");
            }
        });
    } else if (paramd.initd.iri) {
        // if you get here, you're making a JSON Driver connection
        var json_driver = require('./drivers/rest');
        var driver = new json_driver.Driver();
        driver.setup({
            thing: null,
            initd: paramd.initd
        });

        var thing_identity = driver.identity().thing_id;
        self._ask_thing(thing_identity, null, function (callbackd) {
            var model_iri = callbackd.deviced['iot:model'];
            if (model_iri) {
                self._discover_bind({
                    model: model_iri,
                    initd: paramd.initd
                }, things);
            } else {
                // console.log("# IOT._discover_bind: unexpected state: no iot:model?");
                logger.error({
                    method: "_discover_bind"
                }, "unexpected state - no iot:model?");
            }
        });
    } else if (paramd.initd.driver) {
        return self._discover_nearby(paramd.initd, things);
    } else {
        // console.log("# IOT._discover_bind: ERROR: no model_code, model_iri or initd.iri");
        logger.error({
            method: "_discover_bind"
        }, "no model_code, model_iri or initd.iri");
    }
};

/**
 *  Bind a Model to an API IRI. This is great
 *  for accessing simple JSON functionality. If you
 *  need something more fancy, use
 *  {@link IOT#discover IOT.discover}
 *
 *  @paramd {url} iri
 *  The IRI of a JSON
 *
 *  @paramd {*} model
 *  The code of a Model, the IOTDB IRI of a model,
 *  the Model function or a Model exemplar.
 *
 */
IOT.prototype._discover_json = function (iri, model) {
    var self = this;

    if (model) {
        return self._discover_bind({
            model: model,
            initd: {
                iri: iri
            }
        });
    } else {
        return self._discover_bind({
            driver: "iot-driver:rest",
            initd: {
                iri: iri
            }
        });
    }
};


/**
 *  Bind a Thing to a Driver.
 *  <p>
 *  This calls {@link Thing#driver_setup Model.driver_setup}
 *  to get initialization that may have
 *  been defined for this Model.
 *  <p>
 *  This then calls {@link Driver#setup Driver.driver_setup}
 *  to complete the binding.
 *  <p>
 *  The {@link Driver#setup Driver.driver_setup} function
 *  is passed a callback that may be in the future be invoked
 *  to send updated data to this Thing. This is very similar
 *  to {@link Thing#pull Model.pull}, except the Driver
 *  gets to decide when to call it rather than the end user
 *
 *  @protected
 */
IOT.prototype._bind_driver = function (thing, driver_instance) {
    var self = this;

    thing.driver_instance = driver_instance;
    thing.initd = _.deepCopy(thing.initd);

    var paramd = {
        thing: thing,
        initd: _.deepCopy(thing.initd), // DPJ 2014-11-27 check for issues
    };

    thing.driver_setup(paramd);

    /*
     *  anything 'driver_setup' puts in paramd.initd
     *  gets copied back into thing.initd -- if it's
     *  not set already. This lets the end user customize
     *  what the Model natively sets
     */
    for (var key in paramd.initd) {
        if (thing.initd[key] !== undefined) {
            continue;
        }

        thing.initd[key] = paramd.initd[key];
    }

    /*
     *  Now 'initd' is the combined thing's initd again
     */
    paramd.initd = thing.initd;
    driver_instance.setup(paramd);

    return self;
};

/**
 *  Because we're not really talking to the correct
 *  Driver, we swap out all the functions that
 *  talk to the Driver with the original Model
 *  null functions.
 */
IOT.prototype._bind_transport = function (thing, driver_instance) {
    var self = this;

    logger.info({
        method: "_bind_transport",
        thing_code: thing.get_code(),
        initd: thing.initd,
    }, "binding Thing using Driver as transport");

    thing.driver_instance = driver_instance;
    thing.initd = _.deepCopy(thing.initd);

    driver_instance.setup({
        thing: thing,
        initd: thing.initd,
    });

    thing.driver_in = function (paramd) {
        for (var key in paramd.driverd) {
            paramd.thingd[key] = paramd.driverd[key];
        }
    };
    thing.driver_out = function (paramd) {
        for (var key in paramd.thingd) {
            var value = paramd.thingd[key];
            if ((value !== null) && (value !== undefined)) {
                paramd.driverd[key] = value;
            }
        }
    };

    return self;
};

/**
 *  Return all the things currently found as a {@link ThingArray}.
 */
IOT.prototype.things = function (paramd) {
    var self = this;

    paramd = _.defaults(paramd, {
        persist: false
    });

    var ts = new thing_array.ThingArray(paramd);

    for (var key in self.thing_instanced) {
        var thing = self.thing_instanced[key];
        if (!thing) {
            continue;
        }

        ts.push(thing);

        if (paramd.persist) {
            thing.on_meta(function () {
                ts.things_changed();
            });
        }
    }

    if (paramd.persist) {
        self.on(EVENT_NEW_THING, function (thing) {
            if (!thing) {
                return;
            }

            ts.push(thing);
            ts.things_changed();

            thing.on_meta(function () {
                ts.things_changed();
            });
        });
    }

    return ts;
};

/**
 *  Ask the IOTDB to load Device info for the Thing
 *  into the graph.
 *
 *  @param {string|Thing} thing
 *  If a string, it is expected to be the 'thing_id' for
 *  the Thing.
 *
 *  @protected
 */
IOT.prototype._ask_thing = function (thing, paramd, callback) {
    var self = this;

    if (_.isFunction(paramd)) {
        callback = paramd;
        paramd = {};
    }

    var thing_iri = self.thing_iri(thing);
    if (thing_iri == null) {
        if (callback) {
            callback({
                // thing: thing,
                thing_iri: thing_iri,
                paramd: paramd,
                error: "IOT._ask_thing: no thing_iri, likely an unbound Thing"
            });
        }
        return;
    }

    // device already loaded
    var deviced = self.gm.get_dictionary(thing_iri);
    if (deviced && deviced.length) {
        thing.meta_changed();
        if (callback) {
            callback({
                deviced: null,
                thing: thing,
                thing_iri: thing_iri,
                paramd: paramd,
                error: null,
            });
        }
        return;
    }

    // do something when the model is found
    if (callback) {
        var listener = function (_thing_iri) {
            if (_thing_iri !== thing_iri) {
                return;
            }

            var deviced = self.gm.get_dictionary(thing_iri);
            if (deviced) {
                thing.meta_changed();
                callback({
                    deviced: deviced,
                    thing: thing,
                    thing_iri: thing_iri,
                    paramd: paramd,
                    error: null,
                });
            } else {
                callback({
                    deviced: null,
                    thing: thing,
                    thing_iri: thing_iri,
                    paramd: paramd,
                    error: "device not found on IOTDB",
                });
            }

            self.removeListener(graph.GraphManager.EVENT_UPDATED_DEVICE, listener);
            self.removeListener(graph.GraphManager.EVENT_FAILED_IRI, listener);
        };

        self.on(graph.GraphManager.EVENT_UPDATED_DEVICE, listener);
        self.on(graph.GraphManager.EVENT_FAILED_IRI, listener);
    }

    self.on_graph_ready(function () {
        self.gm.load_iri(thing_iri);
    });
};

/**
 *  Ask the IOTDB to load the Model into the Graph. The Model
 *  will be passed in the callback
 *
 *  @param {dictionary} paramd
 *  @param {string} paramd.model_code
 *  The model_code of Model to return.
 *
 *  @param {string} paramd.model_iri
 *  The model_iri of Model to return
 *
 *  @param {function} callback
 */
IOT.prototype.ask_model = function (paramd, callback) {
    var self = this;

    if (_.isFunction(paramd)) {
        callback = paramd;
        paramd = {};
    }

    if (!paramd.model_code && !paramd.model_iri) {
        throw new Error("IOT.ask_model: expected paramd.mode_code or paramd.model_iri");
    }

    if (!paramd.model_iri) {
        paramd.model_iri = self.model_code_iri(paramd.model_code);
    }
    if (!paramd.model_code) {
        paramd.model_code = _.iri_to_code(paramd.model_iri);
    }

    var model_iri = paramd.model_iri;
    var model_code = paramd.model_code;

    /*
     *  Edge case - a class is passed in and we've never seen it
     *  before. Just store an exemplar and the rest of the code
     *  will do the right thing
     */
    if (paramd.model && paramd.model_code) {
        var model_exemplar = self.get_model_exemplar(model_code);
        if (!model_exemplar) {
            self.model_exemplard[paramd.model_code] = new paramd.model();
        }
    }

    // console.log("B", model_code);
    // look for this model
    // - we block out a lot here to allow models to be forward loaded
    self.on_graph_ready(function () {
        // already found this model?
        var model_exemplar = self.get_model_exemplar(model_code);
        if (model_exemplar) {
            // console.log("B.1");
            if (callback) {
                callback({
                    model_code: model_code,
                    model_exemplar: model_exemplar,
                    model_iri: model_iri,

                    error: null
                });
            }

            return;
        }

        // console.log("E.1", callback);
        // do something when the model is found
        if (callback) {
            // console.log("E.2");
            var listener = function (_model_iri) {
                // console.log("E.3");

                if (_model_iri !== model_iri) {
                    return;
                }

                var model_exemplar = self.get_model_exemplar(model_code);
                if (model_exemplar == null) {
                    callback({
                        model_code: model_code,
                        model_exemplar: null,
                        model_iri: model_iri,
                        paramd: paramd,
                        error: self.gm.irid[model_iri]
                    });
                } else {
                    callback({
                        model_code: model_code,
                        model_exemplar: model_exemplar,
                        model_iri: model_iri,
                        paramd: paramd,
                        error: null
                    });
                }

                self.removeListener(graph.GraphManager.EVENT_UPDATED_MODEL, listener);
                self.removeListener(graph.GraphManager.EVENT_FAILED_IRI, listener);
            };

            self.on(graph.GraphManager.EVENT_UPDATED_MODEL, listener);
            self.on(graph.GraphManager.EVENT_FAILED_IRI, listener);
        }

        self.gm.load_iri(model_iri);
    });
};

/**
 *  Return the IOTDB Model IRI for this Thing, based on the
 *  model_code. Does not depend on the Graph.
 *
 *  @param {*} model
 *  The code of a Model, the IOTDB IRI of a model,
 *  the Model function or a Model exemplar.
 *
 *  @return {string}
 *  The IRI on IOTDB for the Thing's Model.
 */
IOT.prototype.model_code_iri = function (model) {
    var self = this;

    var resultd = {};

    // something of a hack to avoid recursion. Sorry!
    if (_.isAbsoluteURL(model)) {
        resultd.model_code = _.iri_to_code(resultd.model_iri);
    } else if (_.isString(model)) {
        resultd.model_code = model;
    } else {
        self._clarify_model(resultd, model);
    }

    if (!resultd.model_code) {
        // console.log("# IOT.model_code_iri: could not get 'model_code'?");
        logger.error({
            method: "model_code_iri"
        }, "could not get a model_code?");
        return;
    }

    return self.iotdb_prefix + "/" + self.username + "/models/" + _.identifier_to_dash_case(resultd.model_code);
};

/**
 *  Return the IOTDB Thing IRI for this Thing
 *
 *  <p>
 *  Note that the Thing must have been "discovered" by IOT
 *  using IOT._discover_thing. Just creating a Thing object
 *  and calling this will have an unhappy result, as it
 *  is not bound to a driver_instance and thus does not have an identity
 *
 *  @param {string|Thing} self
 *  If a string, it is expected to be the 'thing_id' for
 *  the Model.
 *
 *  @return {string}
 *  The IRI on IOTDB to find this Device
 */
IOT.prototype.thing_iri = function (thing) {
    var self = this;

    var thing_id = null;
    if (_.isString(thing)) {
        thing_id = thing;
    } else {
        thing_id = thing.thing_id();
        if (thing_id == null) {
            if (!self.shutting_down) {
                logger.error({
                    method: "thing_iri"
                }, "thing_id is null:perhaps not bound to a driver yet?");
            }
            return null;
        }
    }

    return self.iotdb_prefix + "/" + self.username + "/things/" + encodeURIComponent(thing_id);
};

/**
 *  Disambiguate the model.
 *
 *  <p>
 *  If there's a valid input, <code>model_code</code>
 *  will always come back in <code>resultd</code>
 *  and it will always be in proper dash-case
 *
 *  @protected
 */
IOT.prototype._clarify_model = function (resultd, model) {
    var self = this;

    resultd.model = null;
    resultd.model_exemplar = null;
    resultd.model_iri = null;
    resultd.model_code = null;

    if (model === undefined) {
        // console.log("# IOT._clarify_model: model is undefined. This should never happen");
        logger.error({
            method: "_clarify_model",
            cause: "likely programmer error"
        }, "model is undefined - this should never happen");
    } else if (model == null) {
        // console.log("# IOT._clarify_model: model is null. This should rarely happen");
        logger.error({
            method: "_clarify_model",
            cause: "likely upstream error"
        }, "model is null - this should rarely happen");
    } else if (_.isAbsoluteURL(model)) {
        resultd.model_iri = model;
        resultd.model_code = _.iri_to_code(resultd.model_iri);
    } else if (_.isString(model)) {
        resultd.model_iri = model;
        resultd.model_code = _.identifier_to_dash_case(model);
        resultd.model_iri = self.model_code_iri(resultd.model_code);
    } else if (_.isFunction(model)) {
        resultd.model_iri = model;
        resultd.model = model;
        resultd.model_exemplar = new resultd.model();
        resultd.model_code = resultd.model_exemplar.code;
    } else if (model.make) {
        resultd.model_iri = model;
        resultd.model_exemplar = model;
        resultd.model = model.Model;
        resultd.model_code = resultd.model_exemplar.code;
    } else {
        // console.log("# IOT._model: model was not a URL, string, exemplar or class", "\n ", model);
        logger.error({
            method: "_clarify_model",
            cause: "programmer error",
            model: model
        }, "model was not a URL, string, exemplar or class");
    }
};


/**
 *  Return the model for the 'model_code'.
 *
 *  @param {string} model_code
 *  The Model to find
 *
 *  @return {Model|null}
 *  The Model, or null if it's not loaded or unfindable
 */
IOT.prototype.get_model_exemplar = function (model_code) {
    var self = this;

    model_code = _.identifier_to_dash_case(model_code);

    var model_exemplar = self.model_exemplard[model_code];
    if (model_exemplar) {
        return model_exemplar;
    }

    var model_iri = self.model_code_iri(model_code);
    var model = self._build_model(model_iri);
    if (!model) {
        return;
    }

    model_exemplar = new model();
    if (model_exemplar) {
        self.model_exemplard[model_code] = model_exemplar;
    }

    return model_exemplar;
};

/**
 *  Given the IRI for a Model that has been
 *  loaded into the graph, return an Thing class
 *  to work with it.
 *
 *  @protected
 */
IOT.prototype._build_model = function (model_iri) {
    var self = this;

    var tm = exports.make_model();
    var at_types = [];

    tm.code(_.iri_to_code(model_iri));

    var ts = self.gm.get_triples(model_iri);
    if (ts.length === 0) {
        logger.error({
            method: "_build_model",
            model_iri: model_iri,
            cause: "this model has not been downloaded - Node-IOTDB error?",
        }, "no triples");
        return null;
    }

    for (var ti in ts) {
        var t = ts[ti];

        if (t.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
            at_types.push(_.compact(t.object_value));
        } else if (t.predicate === "iot:attribute") {
            var attribute = self._build_attribute(t.object_value);
            if (attribute) {
                tm.attribute(attribute);
            }
        } else if (t.predicate === "iot:model") {
            var subthing_code = _.iri_to_code(t.object);
            var subthing_model = self._build_model(t.object);
            tm.subthing(subthing_code, subthing_model);
        } else if (t.predicate === "iot:uuid") {} else if (t.predicate === "iot:name") {
            tm.name(t.object_value);
        } else if (t.predicate === "iot:description") {
            tm.description(t.object_value);
        } else if (t.predicate === "iot:help") {
            tm.help(t.object_value);
        } else if (t.predicate === "iot-iotdb:model-validator") {
            /*
             *  XXX - Sandbox Goes Here
             */
            tm.validator(function (paramd) {
                logger.fatal({
                    method: "_build_model",
                    cause: "Node-IOTDB issue - get in touch please",
                }, "cannot run validator because IOTDB has not implemented a sandbox (yet)");
                throw new Error("SANDBOX NEEDS TO BE IMPLEMENTED");
                /*
                var f = eval("var x = " + t.object.value + "; x");
                f(paramd);
                 */
            });
        } else {
            logger.error({
                method: "_build_model",
                predicate: t.predicate,
                model_iri: model_iri,
                cause: "Node-IOTDB issue - get in touch please",
            }, "unrecognized predicate");
        }
    }

    if (at_types.indexOf("iot:Model") === -1) {
        logger.error({
            method: "_build_model",
            at_types: at_types,
            model_iri: model_iri,
            cause: "bad Model - maybe the IRI doesn't lead to a Model?",
        }, "iot:Model not in @types");
        return null;
    }

    return tm.make();
};

/*
 *  @protected
 */
IOT.prototype._build_attribute = function (attribute_iri) {
    var self = this;

    var a = new exports.Attribute();
    a.code(_.iri_to_code(attribute_iri));

    var at_types = [];

    var ts = self.gm.get_triples(attribute_iri, null, null, {
        compact_object: false
    });
    for (var ti in ts) {
        var t = ts[ti];

        if (t.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
            at_types.push(_.compact(t.object_value));
        } else if (t.predicate === "validator") {
            a.validator(t.object_value);
        } else if (t.object.value !== undefined) {
            a.property_value(t.predicate, t.object.value);
        } else if (t.object) {
            a.property_value(t.predicate, t.object);
        }
    }

    if (at_types.indexOf("iot:Attribute") === -1) {
        console.log("thing_from_jsonld:_build_attribute: iot:Attribute not in @types");
        return null;
    }

    return a.make();
};

/**
 *  Whenenver a new Thing is added, automatically
 *  look up its Thing, Place and Model info
 *
 *  If 'self.initd.iotdb_thing_create' is True,
 *  we auto-register a device
 *
 *  @protected
 */
IOT.prototype._iotdb_thing_get = function () {
    var self = this;

    // console.log("C.1");
    self.on(EVENT_NEW_THING, function (thing) {
        // MAGIC!
        if (thing.initd && thing.initd.__internal) {
            return;
        }

        var identity = thing.identity();
        console.log("- IOT._iotdb_thing_get",
            "\n  IRI", thing.initd.api_iri,
            "\n  thing_id", identity.thing_id,
            "\n  model_code", thing.code
        );
        self._ask_thing(thing, null, function (callbackd) {
            console.log("- IOT._iotdb_thing_get: _ask_thing/callbackd",
                "\n  .iri", callbackd.thing_iri,
                "\n  .deviced", callbackd.deviced,
                "\n  .error", callbackd.error,
                "\n  .iotdb_thing_create", self.initd.iotdb_thing_create);
            if (_.isEmpty(callbackd.deviced) && self.initd.iotdb_thing_create) {
                // console.log("C.5");
                var inits = [];
                for (var key in identity) {
                    var value = identity[key];
                    inits.push(key);
                    inits.push(value);
                }

                var ndeviced = {
                    '@type': 'iot:device',
                    'iot:device-identity': identity.thing_id,
                    'iot:driver-initd': inits,
                    'iot:model': "/" + self.username + "/models/" + thing.code,
                    'iot:name': thing.code
                };
                var nthing_iri = self.iotdb_prefix + "/" + self.username +
                    "/things/" + encodeURIComponent(identity.thing_id);

                var headerd = {
                    'Accept': 'application/ld+json'
                };
                if (self.iotdb_oauthd.access_token) {
                    headerd["Authorization"] = "Bearer " + self.iotdb_oauthd.access_token;
                }

                unirest
                    .put(nthing_iri)
                    .headers(headerd)
                    .type('json')
                    .send(ndeviced)
                    .end(function (result) {
                        console.log("- IOT._iotdb_thing_get: _ask_thing/iotdb_thing_create",
                            "\n  nthing_iri", nthing_iri,
                            "\n  body", result.body
                        );
                    });
            }
        });
    });
};

/**
 *  Automatically load all drivers. Set 'IOT.paramd.load_drivers'
 *
 *  @protected
 */
IOT.prototype._load_drivers = function () {
    var self = this;

    var filenames = cfg.cfg_find(self.envd, self.initd.drivers_path, /[.]js$/);
    cfg.cfg_load_js(filenames, function (paramd) {
        if (paramd.error) {
            /*
            console.log("# IOT._load_drivers:",
                "\n  filename", paramd.filename,
                "\n  error", paramd.error,
                "\n  exception", paramd.exception,
                "\n  stack", paramd.exception ? paramd.exception.stack : null
                )
             */
            logger.error({
                method: "_load_drivers",
                filename: paramd.filename,
                error: paramd.error,
                exception: paramd.exception,
            }, "error loading JS Driver");

            if (paramd.exception) {
                self.report_issue({
                    section: "drivers",
                    name: path.basename(paramd.filename),
                    exception: paramd.exception
                });
            } else if (paramd.message) {
                self.report_issue({
                    section: "drivers",
                    name: path.basename(paramd.filename),
                    message: paramd.exception
                });
            }
            return;
        }

        var module = paramd.doc;
        if (module.Driver) {
            // console.log("- IOT._load_drivers", "found Driver", "\n ", paramd.filename);
            logger.info({
                method: "_load_drivers",
                filename: paramd.filename
            }, "found Driver");
            self.register_driver(module.Driver);
        } else {
            // console.log("- IOT._load_drivers", "missing exports.Driver?", "\n ", paramd.filename);
            logger.error({
                method: "_load_drivers",
                filename: paramd.filename,
                cause: "likely a programming eorror in <Driver>.js"
            }, "missing exports.Driver");
        }
    });
};

/**
 *  Automatically load all stores. Set 'IOT.paramd.load_stores'
 *
 *  @protected
 */
IOT.prototype._load_stores = function () {
    var self = this;

    var filenames = cfg.cfg_find(self.envd, self.initd.stores_path, /[.]js$/);
    cfg.cfg_load_js(filenames, function (paramd) {
        if (paramd.error) {
            /*
            console.log("# IOT._load_stores:", 
                "\n  filename", paramd.filename, 
                "\n  error", paramd.error, 
                "\n  exception", paramd.exception)
             */
            logger.error({
                method: "_load_stores",
                filename: paramd.filename,
                error: paramd.error,
                exception: paramd.exception,
            }, "error loading JS Store");

            if (paramd.exception) {
                self.report_issue({
                    section: "stores",
                    name: path.basename(paramd.filename),
                    exception: paramd.exception
                });
            } else if (paramd.message) {
                self.report_issue({
                    section: "stores",
                    name: path.basename(paramd.filename),
                    message: paramd.exception
                });
            }

            return;
        }

        var module = paramd.doc;
        if (module.Store) {
            // console.log("- IOT._load_stores:", "found Store", "\n ", paramd.filename);
            logger.debug({
                method: "_load_stores",
                filename: paramd.filename
            }, "found Store");
            self.register_store(module.Store);
        } else {
            // console.log("- IOT._load_stores:", "missing exports.Store?", "\n ", paramd.filename);
            logger.error({
                method: "_load_stores",
                filename: paramd.filename,
                cause: "likely a programming error in <Store>.js"
            }, "missing exports.Store");
        }
    });
};

/**
 *  Automatically load all transmogrifer. Set 'IOT.paramd.load_transmogrifiers'
 *
 *  @protected
 */
IOT.prototype._load_transmogrifiers = function () {
    var self = this;

    var filenames = cfg.cfg_find(self.envd, self.initd.transmogrifiers_path, /[.]js$/);
    cfg.cfg_load_js(filenames, function (paramd) {
        if (paramd.error) {
            /*
            console.log("# IOT._load_transmogrifiers:", 
                "\n  filename", paramd.filename, 
                "\n  error", paramd.error, 
                "\n  exception", paramd.exception)
             */
            logger.error({
                method: "_load_transmogrifiers",
                filename: paramd.filename,
                error: paramd.error,
                exception: paramd.exception,
            }, "error loading JS Store");

            if (paramd.exception) {
                self.report_issue({
                    section: "filters",
                    name: path.basename(paramd.filename),
                    exception: paramd.exception
                });
            } else if (paramd.message) {
                self.report_issue({
                    section: "filters",
                    name: path.basename(paramd.filename),
                    message: paramd.exception
                });
            }

            return;
        }

        var module = paramd.doc;
        if (module.Transmogrifier) {
            // console.log("- IOT._load_transmogrifiers:", "found Store", "\n ", paramd.filename);
            logger.debug({
                method: "_load_transmogrifiers",
                filename: paramd.filename
            }, "found Store");
            self.register_transmogrifier(module.Transmogrifier);
        } else {
            // console.log("- IOT._load_transmogrifiers:", "missing exports.Store?", "\n ", paramd.filename);
            logger.error({
                method: "_load_transmogrifiers",
                filename: paramd.filename,
                cause: "likely a programming error in <Transmogrifier>.js"
            }, "missing exports.Transmogrifier");
        }
    });
};

/**
 *  Automatically load all Models from modules. Set 'IOT.paramd.load_model_modules'
 *
 *  @protected
 */
IOT.prototype._load_model_modules = function () {
    var self = this;
    // console.log("- IOT._load_model_modules", "modules", self.initd.model_modules);
    logger.info({
        method: "_load_model_modules",
        models_modules: self.initd.models_modules
    }, "loading Models in modules");

    for (var mi in self.initd.models_modules) {
        var model_module = self.initd.models_modules[mi];
        var module = require(model_module);
        for (var i in module.models) {
            var model = module.models[i];
            self.register_model(model);
        }
    }
};

/**
 *  Automatically load all Models. Set 'IOT.paramd.load_models'
 *
 *  @protected
 */
IOT.prototype._load_models = function () {
    var self = this;

    // console.log("- IOT._load_models", "loading models", self.initd.models_path);
    logger.info({
        method: "_load_models",
        models_path: self.initd.models_path
    }, "loading Models");

    var filenames = cfg.cfg_find(self.envd, self.initd.models_path, /[.]js$/);
    // console.log("- IOT._load_models", "filenames", filenames, self.envd);
    cfg.cfg_load_js(filenames, function (paramd) {
        if (paramd.error) {
            if (paramd.filename) {
                // console.log("# IOT._load_models:", paramd.error, paramd.exception, paramd.filename);
                logger.error({
                    method: "_load_models",
                    filename: paramd.filename,
                    error: paramd.error,
                    exception: paramd.exception,
                }, "error loading JS Model");
            }
            return;
        }

        var module = paramd.doc;
        if (module.Model) {
            // console.log("- IOT._load_models:", "found Model", "\n ", paramd.filename);
            logger.debug({
                method: "_load_models",
                filename: paramd.filename
            }, "found Model");
            self.register_model(module.Model);
        } else {
            // console.log("- IOT._load_models:", "missing exports.Model?", paramd.filename);
            logger.error({
                method: "_load_models",
                filename: paramd.filename,
                cause: "likely a programming error in <Model>.js"
            }, "missing exports.Model");
        }
    });
};

/**
 *  Automatically load all Things. Set 'IOT.paramd.load_things'
 *
 *  @protected
 */
IOT.prototype._load_things = function () {
    var self = this;

    // console.log("- IOT._load_things", "loading things", self.initd.things_path);
    logger.info({
        method: "_load_things",
        models_path: self.initd.things_path
    }, "loading Things");

    var filenames = cfg.cfg_find(self.envd, self.initd.things_path, /[.]json$/);
    cfg.cfg_load_js(filenames, function (paramd) {
        if (paramd.error) {
            if (paramd.filename) {
                // console.log("# IOT._load_things:", paramd.error, paramd.exception, paramd.filename);
                logger.error({
                    method: "_load_things",
                    filename: paramd.filename,
                    error: paramd.error,
                    exception: paramd.exception,
                }, "error loading JS Thing");
            }
            return;
        }

        var jd = self.format(paramd.doc);
        // console.log("- IOT._load_things", JSON.stringify(jd, null, 2));
        logger.info({
            method: "_load_things",
            jd: jd
        }, "loading this thing");
        self.discover(jd);
    });
};

/**
 *  When the number of things is greater than 0
 *  and it is stable, call the callback
 *
 *  @param {function} callback
 */
IOT.prototype.on_things = function (callback, paramd) {
    var self = this;

    paramd = _.defaults(paramd, {
        min_things: 1,
        time_delta: 1000
    });

    var nthings = 0;
    var timeoutId = timers.setInterval(function () {
        var things = self.things();
        if (things.length < paramd.min_things) {
            // console.log("- IOT.on_things: waiting for things to stabilize", things.length);
            logger.debug({
                method: "on_things",
                nthings: things.length
            }, "waiting for things to stabilize");
            return;
        }

        if (things.length === nthings) {
            clearTimeout(timeoutId);
            callback(things, paramd);
            return;
        }

        nthings = things.length;
    }, paramd.time_delta);

    return self;
};


/* --- places section -- */
/**
 *  The IRI for places data
 */
IOT.prototype.places_iri = function () {
    var self = this;
    return self.iotdb_prefix + "/" + self.username + "/places";
};

/**
 *  Automatically load all places from IOTDB. Set 'IOT.paramd.iotdb_places_get'
 *  or just call me.
 *
 *  @protected
 */
IOT.prototype.iotdb_places_get = function () {
    var self = this;
    var places_iri = self.iotdb_prefix + "/" + self.username + "/places";

    self.gm.load_iri(self.places_iri(), function (paramd) {});
};

/**
 *  When all places are loaded, this will be called.
 *  There's the potential of timing issues, make sure
 *  to either use 'iotdb_places_get' or to call 'XXX'
 *
 *  @param {function} callback
 */
IOT.prototype.on_places = function (callback, paramd) {
    var self = this;

    var event = graph.GraphManager.EVENT_UPDATED_GRAPH;
    var listener = function () {
        if (self.gm.is_active()) {
            return false;
        }

        callback(self.places(), paramd);
        self.removeListener(event, listener);
        return true;
    };

    if (listener()) {
        return;
    } else {
        self.on(event, listener);
    }
};

/**
 */
IOT.prototype.places = function () {
    var self = this;

    var pds = [];
    var iris = this.gm.get_subjects('http://www.w3.org/1999/02/22-rdf-syntax-ns#type', 'iot:place');
    for (var ii in iris) {
        var iri = iris[ii];
        var pd = self.gm.get_dictionary(iri);

        pd["iot:place"] = iri;
        pds.push(pd);
    }

    return pds;
};

/* -------------- NEW STUFF Node-IOTDB-V2--------------- */

/**
 *  Connect to devices. This is the most important
 *  function in IOT
 */
IOT.prototype.connect = function (value) {
    var self = this;
    var connectd;
    var things = new thing_array.ThingArray({
        persist: true
    });

    if (value === undefined) {
        self._discover_nearby(null, things);

        return self.things({
            persist: true
        });
    } else if (_.isString(value)) {
        connectd = {};

        if (value.match(/^:/) || value.match(/^iot-driver:/)) {
            value = _.expand(value, "iot-driver:");
        }

        var driver_prefix = "https://iotdb.org/pub/iot-driver#";
        if (value.substring(value, driver_prefix.length) === driver_prefix) {
            connectd.driver = value;
            self._connect(connectd, things);
            // XXX - set up thing_array
        } else if (value.match(/^https?:\/\//)) {
            connectd.iri = value;
            self._connect(connectd, things);
            // XXX - set up thing_array
        } else {
            connectd.model = value;
            self._connect(connectd, things);
            return self.things({
                persist: true
            }).with_model(value);
        }
    } else if (_.isObject(value)) {
        connectd = value;

        for (var key in connectd) {
            var v = connectd[key];
            if (_.isString(v) && v.indexOf('{{') > -1) {
                connectd[key] = self.format(v);
            }
        }

        if (connectd.driver) {
            connectd.driver = _.expand(connectd.driver, "iot-driver:");
        }

        self._connect(connectd, things);
    } else {
        // console.log("# IOT.connect: unexpected argument type", value);
        logger.error({
            method: "connect",
            argument: value
        }, "unexpected/unknown argument type");
    }

    return things;
};

/**
 *  @protected
 */
IOT.prototype._connect = function (connectd, things) {
    var self = this;

    if (connectd.iri && !(connectd.model || connectd.driver)) {
        connectd.model = exports.make_generic();
    }

    self.on_ready(function () {
        self._discover_bind(connectd, things);
    });

    return things;
};

/**
 *  Persist all changes to metadata.
 *  <p>
 *  Tons of work needed here
 */
IOT.prototype.meta_save = function () {
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

    for (var thing_id in self.thing_instanced) {
        var thing = self.thing_instanced[thing_id];
        if (!thing) {
            continue;
        }

        var meta = thing.meta();
        if (_.isEmpty(meta.updated)) {
            continue;
        }

        var file_meta = path.join(meta_dir, thing_id.replace(/^.*:/, '') + ".json");
        fs.writeFileSync(file_meta, JSON.stringify(meta.updated, null, 2) + "\n");

        console.log("- IOT.meta_save", "wrote", file_meta);
    }
};

/**
 *  Print out info about a bunch of things
 */
IOT.prototype.dump = function (things) {
    _.dump_things(this, things);
};

/**
 *  Info on what got loaded
 */
IOT.prototype.health = function () {
    var self = this;

    var interaction = new Interaction();

    // drivers
    interaction.header("Available drivers:");
    interaction.log();

    for (var di in self.driver_exemplars) {
        var d = self.driver_exemplars[di];
        interaction.log(_.compact(d.driver));
    }

    interaction.log();

    // stores
    interaction.header("Available stores:");
    interaction.log();

    for (var sname in self.store_instanced) {
        interaction.log(_.compact(sname));
    }
    interaction.log();

    // models
    interaction.header("Available models:");
    interaction.log();

    var mnames = [];
    for (var mname in self.model_exemplard) {
        mnames.push(_.compact(mname));
    }
    mnames.sort();
    for (var mi in mnames) {
        interaction.log(mnames[mi]);
    }
    interaction.log();

    // issues
    if (self.issueds) {
        var sections = {};
        for (var ii in self.issueds) {
            sections[self.issueds[ii].section] = 1;
        }
        sections = _.keys(sections);
        sections.sort();

        for (var si in sections) {
            var section = sections[si];
            interaction.header("Issue with %s:", section);
            interaction.log();

            for (var sii in self.issueds) {
                var issued = self.issueds[sii];
                if (issued.section !== section) {
                    continue;
                }

                interaction.log("%s: %s", issued.name, issued.message);
            }

            interaction.log();
        }
    }

    interaction.end();
};

IOT.prototype.report_issue = function (issued) {
    var self = this;

    assert.ok(issued.section);
    assert.ok(issued.name);

    if (issued.exception && _.isEmpty(issued.message)) {
        if (!_.isEmpty(issued.exception.message)) {
            issued.message = issued.exception.message;
        } else {
            issued.message = "" + issued.exception;
        }
    }

    self.issueds.push(issued);
};

/*
 *  API
 */
exports.IOT = IOT;
exports.shutting_down = function () {
    if (exports.instance == null) {
        return exports.instance.shutting_down;
    } else {
        return false;
    }
};

exports.EVENT_REGISTER_MODEL = EVENT_REGISTER_MODEL;
exports.EVENT_REGISTER_BRIDGE = EVENT_REGISTER_BRIDGE;
exports.EVENT_NEW_THING = EVENT_NEW_THING;

exports.attribute = require('./attribute');
for (var key in exports.attribute) {
    exports[key] = exports.attribute[key];
}

exports.model = require('./model');
exports.make_model = exports.model.make_model;
exports.make_generic = require('./generic').make_generic;
exports.GraphManager = require('./graph').GraphManager;
exports.helpers = _;
exports.cfg = cfg;
exports.libs = libs.libs;

exports.EVENT_UPDATE_SUBJECT = exports.GraphManager.EVENT_UPDATED_SUBJECT;
exports.EVENT_UPDATED_GRAPH = exports.GraphManager.EVENT_UPDATED_GRAPH;
exports.EVENT_LOADED_IRI = exports.GraphManager.EVENT_LOADED_IRI;
exports.EVENT_UPDATED_DEVICE = exports.GraphManager.EVENT_UPDATED_DEVICE;
exports.EVENT_UPDATED_PLACE = exports.GraphManager.EVENT_UPDATED_PLACE;
exports.EVENT_UPDATED_MODEL = exports.GraphManager.EVENT_UPDATED_MODEL;
