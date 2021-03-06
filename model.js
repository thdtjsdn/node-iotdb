/*
 *  model.js
 *
 *  David Janes
 *  IOTDB
 *  2013-12-22
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

var assert = require("assert");

var _ = require("./helpers");
var attribute = require("./attribute");
var meta_thing = require("./meta");
var model_maker = require("./model_maker");
var iotdb = require("./iotdb");

var bunyan = require('bunyan');
var logger = bunyan.createLogger({
    name: 'iotdb',
    module: 'model',
});

/* --- constants --- */
var VERBOSE = true;
var iot_name = _.ld.expand("schema:name");
var iot_role = _.ld.expand("iot:role");
var iot_role_reading = _.ld.expand("iot-attribute:role-reading");
var iot_role_control = _.ld.expand("iot-attribute:role-control");

var EVENT_THINGS_CHANGED = "things_changed";
var EVENT_THING_CHANGED = "state";
var EVENT_META_CHANGED = "meta";


/**
 *  Convenience function to make a ModelMaker instance
 *
 *  @param {string|undefined} _name
 *  see {@ThinkMaker} constructor
 *
 *  @return
 *  a new ModelMaker instance
 */
var make_model = function (_name) {
    return new model_maker.ModelMaker(_name);
};

/**
 *  Base class for all Things. It does nothing
 *  except exist.
 *  See {@link Thing~subclass} for arguments
 *  passed to subclasses.
 *
 *  <p>
 *  Generally you'll be using something you've made
 *  with {@link make_model} and won't use this at all
 *
 *  @classdesc
 *  Things are objects that represent real world things
 *  such as 
 *  a {@link http://www.belkin.com/us/Products/home-automation/c/wemo-home-automation/ Belkin WeMo},
 *  a {@link http://www.meethue.com/en-CA Philips Hue},
 *  an Arduino project,
 *  a heartrate monitor,
 *  a scale,
 *  and so forth.
 *  Things can be actuators (that is, they make things
 *  happen in the physical world) or sensors (they give readings).
 *
 *  <p>
 *  The purpose of the IOTDB is to provide a robust abstract description
 *  of all things, so that you can say "turn off the stove" or "set the lights
 *  to sunset red" <b>and the right thing will happen</b>, no matter what 
 *  the actual language, protocols or peculiarities of the real device.
 *
 *  <p>
 *  {@link Thing Things} are bound to real devices using {@link Driver Drivers}. 
 *  Things are designed in such a way that they can run on many modern devices,
 *  such as PCs, Raspberry Pis, iPhones, Androids, etc.. There is a JavaScript requirement,
 *  but just the "pure" language and not any libraries such as Node-JS.
 *
 *  <p>
 *  Here's an example of turning on a Thing and setting the color to red, using the
 *  Thing's native keys
 *
 *  <pre>
thing
    .set('rgb', '#FF0000')
 *  </pre>
 *
 *  <p>
 *  Here's an example of doing the same thing semantically
 *  <pre>
thing
    .set('iot-attribute:on', true)
    .set('iot-attribute:color', '#FF0000')
 *  </pre>
 *
 *  <hr />
 *
 *  @constructor
 */
var Model = function () {};

/**
 *  @callback Thing~subclass
 *
 *  All subclasses of Thing take a single
 *  argument <code>paramd</code>. All the
 *  options are optional.
 *
 *  @param {dictionary} paramd
 *  The driver for this thing.
 *
 *  @param {*} paramd.api_*
 *  All keys that start with api_* have their
 *  values copies
 *
 *  @return {function}
 *  A function that creates a subclass of Model.
 **/

/**
 *  Make a new instance of this Thing, using
 *  the current object as an exemplar.
 *  <p>
 *  See {@link Thing~subclass}
 *
 *  <p>
 *  <i>This uses a very Javascript hack,
 *  see source code for {@link ModelMaker#make ModelMaker.make}
 *  </i></p>
 */
Model.prototype.make = function (paramd) {
    return new this.__make(paramd);
};

/**
 */
Model.prototype.isa = function (classf) {
    return classf === this.__make;
};

/**
 */
Model.prototype.get_code = function () {
    return this.code;
};

/**
 *  State is now constructed on the fly
 */
Model.prototype.state = function (paramd) {
    var self = this;

    paramd = _.defaults(paramd, {
        istate: true,
        ostate: true,
    });

    var state = {};
    var attributes = self.attributes();
    for (var ai in attributes) {
        var attribute = attributes[ai];
        var attribute_code = attribute.get_code();

        var attribute_value = null;
        if (paramd.istate && (attribute._ivalue != null)) {
            attribute_value = attribute._ivalue;
        } else if (paramd.ostate && (attribute._ovalue != null)) {
            attribute_value = attribute._ovalue;
        } else {}

        _.d.set(state, attribute_code, attribute_value);
    }

    return state;
};

/**
 */
Model.prototype.attributes = function () {
    var self = this;
    return self.__attributes;
};

/**
 *  Tags are for locally identitfying devices
 */
Model.prototype.has_tag = function (tag) {
    return _.ld.contains(this.initd, "tag", tag);
};

/**
 *  Return the JSON-LD version of this thing
 *
 *  @param {dictionary} paramd
 *  @param {boolean} paramd.include_state
 *  Include the current state
 *
 *  @param {url} paramd.base
 *  Base URL, otherwise 'file:///<code>/'
 *
 *  @return {dictionary}
 *  JSON-LD dictionary
 */
Model.prototype.jsonld = function (paramd) {
    var self = this;
    var key;
    var value;

    paramd = (paramd !== undefined) ? paramd : {};
    paramd.base = (paramd.base !== undefined) ? paramd.base : ("file:///" + self.code + "");
    paramd.context = (paramd.context !== undefined) ? paramd.context : true;
    paramd.path = (paramd.path !== undefined) ? paramd.path : "";

    var rd = {};
    var nss = {
        "iot": true,
        "schema": true,
    };

    if (paramd.context) {
        var cd = {};
        cd["@base"] = paramd.base;
        cd["@vocab"] = paramd.base + "#";
        rd["@context"] = cd;
        rd["@id"] = "";
    } else if (paramd.path.length > 0) {
        rd["@id"] = "#" + paramd.path.replace(/\/+$/, '');
    } else {
        rd["@id"] = "#";
    }

    rd["@type"] = _.ld.expand("iot:Model");

    if (self.name) {
        rd[_.ld.expand("schema:name")] = self.name;
    }
    if (self.description) {
        rd[_.ld.expand("schema:description")] = self.description;
    }
    if (self.help) {
        rd[_.ld.expand("iot:help")] = self.help;
    }

    if (paramd.include_state) {}

    // attributes
    var ads = [];
    var attributes = self.attributes();
    for (var ax in attributes) {
        var attribute = attributes[ax];
        var ad = {};
        // ad[_.ld.expand('schema:name')] = attribute.get_code()
        ads.push(ad);

        for (key in attribute) {
            if (!attribute.hasOwnProperty(key)) {
                continue;
            }

            value = attribute[key];
            if (value === undefined) {
            } else if (_.isFunction(value)) {
            } else if (key.match(/^_/)) {
            } else if (key === "@id") {
                ad[key] = "#" + paramd.path + value.substring(1);
            } else {
                ad[key] = value;
                nss[key.replace(/:.*$/,'')] = true;
            }
        }
    }
    if (ads.length > 0) {
        rd[_.ld.expand("iot:attribute")] = ads;
        nss["iot-attribute"] = true;
    }

    cd = rd["@context"];
    if (cd) {
        for (var nkey in nss) {
            var ns = _.ld.namespace[nkey];
            if (ns) {
                cd[nkey] = ns;
            }
        }
    }

    return rd;
};

/**
 *  Get a value from the state. Note that there's
 *  no guarentee that the state reflects what your
 *  thing actually is right now
 *
 *  @param find_key
 *  The key (see {@link Thing#_find Model.find} for possibilites)
 *
 *  @return {*}
 *  The current value in the state
 */
Model.prototype.get = function (find_key) {
    var self = this;

    var rd = self._find(find_key, {
        get: true
    });
    if (rd === undefined) {
        // console.log("# Model.get: attribute '" + find_key + "' not found XXX");
        logger.error({
            method: "get",
            find_key: find_key
        }, "cannot find Attribute using find_key");
        return undefined;
    }

    if (rd.attribute) {
        if (rd.attribute._ivalue !== null) {
            return rd.attribute._ivalue;
        } else if (rd.attribute._ovalue !== null) {
            return rd.attribute._ovalue;
        } else {
            return null;
        }
    } else {
        logger.error({
            method: "get",
            find_key: find_key,
            cause: "Node-IOTDB programming error"
        }, "impossible state");

        throw new Error("Model.get: internal error: impossible state for: " + find_key);
    }
};

/**
 *  Set a value.
 *
 *  <p>
 *  If this is not in a {@link Thing#start Model.start}/{@link Thing#end Model.end}
 *  bracketing, no callback notifications will be sent,
 *  the new_value will be validated against the attribute
 *  immediately, and the thing will be validated immediately.
 *
 *  <p>
 *  If it is inside, all those checks will be deferred
 *  until the {@link Thing#end Model.end} occurs.
 *
 *  @param find_key
 *  The key (see {@link Thing#_find Model.find} for possibilites)
 *
 *  @param {*} new_value
 *  The value to set
 */
Model.prototype.set = function (find_key, new_value) {
    var self = this;

    var transaction = _.defaults(self._transaction, {
        force: false,
        push: true,
        validate: true,
    });

    var rd = self._find(find_key, {
        set: true
    });
    if (rd === undefined) {
        logger.warn({
            method: "set",
            find_key: find_key,
            model_code: self.code,
            cause: "likely programmer error"
        }, "attribute not found");
        return self;
    } else if (!rd.attribute) {
        logger.error({
            method: "set",
            find_key: find_key,
            cause: "Node-IOTDB programming error"
        }, "impossible state");

        throw new Error("# Model.get: internal error: impossible state for: " + find_key);
    }

    var attribute = rd.attribute;
    var attribute_key = attribute.get_code();
    var attribute_value_old = transaction.push ? attribute._ovalue : attribute._ivalue;
    var attribute_value_new = transaction.validate ? self._validate(attribute, new_value) : new_value;

    /*
    console.log("ICHANGED.1", 
        attribute._ivalue, attribute_value_new,
        transaction.force,
        (attribute_value_old === attribute_value_new));
     */
    if (!transaction.force && (attribute_value_old === attribute_value_new)) {
        return self;
    }

    if (transaction.push) {
        attribute._ochanged = true;
        attribute._ovalue = attribute_value_new;
        self._do_push(attribute, false);
        self._do_notify(attribute, false);
    } else {
        // console.log("ICHANGED.2", attribute._ivalue, attribute_value_new);
        attribute._ichanged = true;
        attribute._ivalue = attribute_value_new;
        self._do_notify(attribute, false);
    }

    return self;
};

/**
 *  Set many values at once, using a dictionary
 */
Model.prototype.update = function (updated, paramd) {
    var self = this;

    paramd = _.defaults(paramd, {
        notify: true
    });

    self.start(paramd);
    for (var key in updated) {
        self.set(key, updated[key]);
    }
    self.end();


    return self;
};


/**
 *  Start a transaction. No validation, notification
 *  or pushes caused by {@link Thing#set Model.set} will
 *  happen until {@link Thing#end Model.end} is called.
 *
 *  <p>
 *  Transactions may be nested but nothing is "inherited"
 *  from the wrapping transaction.
 *  </p>
 *
 *  @param {boolean} paramd.notify
 *  If true, send notifications. Typically when a user
 *  sets their own values they leave this off.
 *  Default false
 *
 *  @param {boolean} paramd.validate
 *  If true, validate changes. This may be false when
 *  the driver is setting values.
 *  Default false
 *
 *  @param {boolean} paramd.push
 *  If true, push changes to the driver.
 *  Default true
 *
 *  @return
 *  this
 */
Model.prototype.start = function (paramd) {
    var self = this;

    /*
    if (self._transaction) {
        throw new Error("Model.start: cannot nest start/end transactions");
    }
    */

    
    self._transaction = _.defaults(paramd, {
        notify: false,
        validate: true,
        push: true,
        force: false,

        _notifyd: {},
        _validated: {},
        _pushd: {},
    });
    self._transactions = self._transactions || [];
    self._transactions.push(self._transaction);

    return self;
};

/**
 *  End a transaction.
 *  Pending pushes/notification/validation
 *  caused by {@link Thing#set Model.set}
 *  will be done.
 *  There must be a corresponding {@link Thing#start Model.start}
 *  called earlier. (<code>paramd</code> is set in the start).
 *
 *  <p>
 *  Transactions may be nested but nothing is "inherited"
 *  from the wrapping transaction.
 *  </p>
 *
 *  <p>
 *  Order of updating
 *  </p>
 *  <ol>
 *  <li>{@link Thing#end Model.end} is called on all submodels
 *  <li>{@link Thing#_do_notifies notification} (if paramd.notify is true)
 *  <li>{@link Thing#_do_pushes driver} push (if paramd.push is true)
 *  </ol>
 *
 *  @return
 *  this
 */
Model.prototype.end = function () {
    var self = this;

    if (self._transaction) {
        if (self._transaction.notify) {
            self._do_notifies(self._transaction._notifyd);
        }
        self._do_notifies2(self._transaction._notifyd);

        if (self._transaction.push) {
            self._do_pushes(self._transaction._pushd);
        }

        self._transactions.pop();
        if (self._transactions.length) {
            self._transaction = self._transactions[self._transactions.length - 1];
        } else {
            self._transaction = null;
        }
    }

    return self;
};

/**
 *  Register for a callback. See {@link Thing#end Model.end}
 *  for when callbacks will occcur. Note that
 *  also that we try to supress callbacks
 *  if the value hasn't changed, though there's
 *  no guarentee we're 100% successful at this.
 *
 *  @param find_key
 *  The key to monitor for changes
 *  (see {@link Thing#_find Model.find} for possibilites)
 *
 *  @param {function} callback
 *  The callback function, which takes
 *  ( thing, attribute, new_value ) as arguments
 *
 *  @return
 *  this
 */
Model.prototype.on = function (find_key, callback) {
    var self = this;
    var attribute_key = null;
    var callbacks = null;

    /* HORRIBLE. */
    if ((find_key === "state") || (find_key === "meta") || (find_key === "istate") || (find_key === "ostate")) {
        self.__emitter.on(find_key, function (a, b, c) {
            callback(self, a, b, c); /* LAZY */
        });
        return self;
    }

    if (find_key === null) {
        attribute_key = null;

        callbacks = self.callbacksd[attribute_key];
        if (callbacks === undefined) {
            self.callbacksd[attribute_key] = callbacks = [];
        }

        callbacks.push(callback);

        return self;
    }

    var rd = self._find(find_key, {
        on: true
    });
    if (rd === undefined) {
        // console.log("# Model.on: error: attribute '" + find_key + "' not found");
        logger.error({
            method: "on",
            find_key: find_key
        }, "find_key not found");
        return self;
    }

    if (rd.attribute) {
        attribute_key = rd.attribute.get_code();

        callbacks = rd.thing.callbacksd[attribute_key];
        if (callbacks === undefined) {
            rd.thing.callbacksd[attribute_key] = callbacks = [];
        }

        callbacks.push(callback);

        return self;
    } else {
        logger.error({
            method: "on",
            find_key: find_key
        }, "impossible state");

        throw new Error("Model.on: error: impossible state: " + find_key);
    }
};

/**
 *  Register for changes to this Thing. The change callback
 *  is triggered at the of a update transaction.
 *
 *  @param {function} callback
 *  The callback function, which takes
 *  ( thing, changed_attributes ) as arguments
 *
 */
Model.prototype.on_change = function (callback) {
    var self = this;

    assert.ok(_.isFunction(callback));

    self.__emitter.on(EVENT_THING_CHANGED, function (thing) {
        callback(self, []);
    });

    return self;
};

/**
 *  On metadata change (including reachablity)
 */
Model.prototype.on_meta = function (callback) {
    var self = this;

    assert.ok(_.isFunction(callback));

    self.__emitter.on(EVENT_META_CHANGED, function (thing) {
        if (iotdb.shutting_down()) {
            return;
        }

        callback(self, []);
    });

    return self;
};

/*
 *  Send a notification that the metadata has been changed
 */
Model.prototype.meta_changed = function () {
    if (iotdb.shutting_down()) {
        return;
    }

    this.__emitter.emit(EVENT_META_CHANGED, true);
};

/**
 *  @return {dictionary}
 *  An idenitity object
 */
Model.prototype.identity = function (kitchen_sink) {
    var self = this;

    if (self._identityd) {
        return self._identityd;
    }

    return null;
};

Model.prototype.thing_id = function () {
    var id = this.identity();
    if (id) {
        return id.thing_id;
    }

    return null;
};

/**
 *  Request values from the Bridge be brought to this object.
 *  Note that it's asynchronous
 *
 *  @return {this}
 */
Model.prototype.pull = function () {
    var self = this;

    if (self.bridge_instance) {
        self.bridge_instance.pull();
    }

    return self;
};

/* --- internals --- */
/**
 *  Push this updated attribute's value
 *  across the driver to make the change
 *  actually happen.
 *
 *  If there is a no stack or immediate is
 *  <b>true</b>, do the push immediately.
 *  Otherwise we store for later bulk push.
 *
 *  @param attributes
 *  The {@link Attribute} to push
 *
 *  @param immediate
 *  If true, push immediately no matter what
 *
 *  @protected
 */
Model.prototype._do_push = function (attribute, immediate) {
    var self = this;

    if (!self._transaction || immediate) {
        var attributed = {};
        attributed[attribute.get_code()] = attribute;

        self._do_pushes(attributed);
    } else {
        self._transaction._pushd[attribute.get_code()] = attribute;
    }

};

/**
 *  Send values from this object to the Bridge
 *
 *  @return
 *  self
 *
 *  @protected
 */
Model.prototype._do_pushes = function (attributed) {
    var self = this;

    if (!self.bridge_instance) {
        return;
    }

    var mapping = self.bridge_instance.binding.mapping;
    var pushd = {};

    for (var key in attributed) {
        var attribute = attributed[key];
        var attribute_code = attribute.get_code();
        var attribute_value = attribute._ovalue;

        // mappings can be attached to bindings to make enumerations better
        if (mapping !== undefined) {
            var md = mapping[attribute_code];
            if (md !== undefined) {
                var v = md[attribute_value];
                if (v === undefined) {
                    v = md[_.ld.compact(attribute_value)];
                }
                if (v !== undefined) {
                    attribute_value = v;
                }
            }
        }

        _.d.set(pushd, attribute_code, attribute_value);
    }

    self.bridge_instance.push(pushd);
};

/**
 *  Validate this updated attribute. Attribute
 *  should be rewritten to make this redundant
 *
 *  @param attributes
 *  The {@link Attribute} to validate
 *
 *  @protected
 */
Model.prototype._validate = function (attribute, new_value) {
    var self = this;

    var paramd = {
        value: new_value,
        code: attribute.get_code(),
    };

    attribute.validate(paramd);

    return paramd.value;
};

/**
 *  Notify listened of this updated attribute.
 *
 *  If there is a no stack or immediate is
 *  <b>true</b>, do the notifications immediately.
 *  Otherwise we store for later bulk notifications.
 *
 *  @param attributes
 *  The {@link Attribute} that triggers notifications
 *
 *  @param immediate
 *  If true, notify immediately no matter what
 *
 *  @protected
 */
Model.prototype._do_notify = function (attribute, immediate) {
    var self = this;

    if (!self._transaction || immediate) {
        var attributed = {};
        attributed[attribute.get_code()] = attribute;

        self._do_notifies(attributed);
        self._do_notifies2(attributed);
    } else {
        self._transaction._notifyd[attribute.get_code()] = attribute;
    }
};

/**
 *  Do a whole bunch of notifies, one for each
 *  attribute in attributes. Events are bubbled
 *  to parents (clearly identifying the original source!)
 *
 *  <p>
 *  XXX - There's likely a billion things wrong with this code
 *
 *  @param attributed
 *  A dictionary of {@link Attribute}, which are all the changed
 *  attributes.
 *
 *  @protected
 */
Model.prototype._do_notifies = function (attributed) {
    var self = this;
    var any = false;

    for (var attribute_key in attributed) {
        any = true;

        var attribute = attributed[attribute_key];
        var attribute_value = null;
        if (attribute._ivalue != null) {
            attribute_value = attribute._ivalue;
        } else if (attribute._ovalue != null) {
            attribute_value = attribute._ovalue;
        }

        var callbacks = self.callbacksd[attribute_key];
        if (callbacks === undefined) {
            callbacks = self.callbacksd[null];
        }
        if (callbacks) {
            callbacks.map(function (callback) {
                callback(self, attribute, attribute_value);
            });
        }
    }

    // levels of hackdom here
    if (any) {
        this.__emitter.emit(EVENT_THING_CHANGED, self);
    }
};

/**
 *  This does istate/ostate notifications
 */
Model.prototype._do_notifies2 = function (attributed) {
    var self = this;

    var ichanged = false;
    var ochanged = false;

    for (var attribute_key in attributed) {
        var attribute = attributed[attribute_key];
        ichanged |= attribute._ichanged;
        ochanged |= attribute._ochanged;

        attribute._ichanged = false;
        attribute._ochanged = false;
    }

    if (ichanged) {
        self.__emitter.emit("istate", self);
    }
    if (ochanged) {
        self.__emitter.emit("ostate", self);
    }
};

/**
 *  Find the {@link Attribute attribute} or {@link Thing subthing}
 *  of a key in this.
 *
 *  <p>
 *  If find_key is a string, it is split by the "/"
 *  character.
 *  All the except the last parts are traversed
 *  through submodels. The last part is then checked
 *  by the following rules:
 *
 *  <ul>
 *  <li>
 *  If it starts with an ":", we convert it to
 *  <code>iot-attribute:part</code>
 *  and research
 *  for a <code>iot:purpose</code> with that value.
 *
 *  <li>
 *  If it contains a ":" (past the first character),
 *  we {@link helpers:expand expand} and research
 *  for a <code>iot:purpose</code> with that value.
 *
 *  <li>
 *  Otherwise we look for an attribute with that key.
 *  If it's found, we return a dictionary with
 *  <code>{ attribute: attribute, thing: containing-thing }</code>
 *
 *  <li>
 *  Otherwise we look for an subthing with that key.
 *  If it's found, we return a dictionary with
 *  <code>{ subthing: subthing, thing: containing-thing }</code>
 *  </ul>
 *
 *  @param {string|Attribute} find_key
 *  The key to find, noting the rules above
 *
 *  @return {undefined|dictionary}
 *  If nothing is found, undefined.
 *  Otherwise a dictionary describing whether
 *  it was an {@link Attribute} or {@link Thing}
 *  found and what the contaning {@link Thing} is.
 *
 *  @protected
 */
Model.prototype._find = function (find_key, paramd) {
    var self = this;
    var d;
    var attribute;

    paramd = _.defaults(paramd, {
        set: false,
        get: false,
        on: false,
    });

    if (typeof find_key === "string") {
        var subkeys = find_key.replace(/\/+/, "").split("/");
        var thing = self;

        var last_key = subkeys[subkeys.length - 1];
        if (last_key.substring(0, 1) === ":") {
            d = {};
            d[_.ld.expand("iot:purpose")] = _.ld.expand("iot-attribute:" + last_key.substring(1));

            return thing._find(d, paramd);
        } else if (last_key.indexOf(":") > -1) {
            d = {};
            d[_.ld.expand("iot:purpose")] = _.ld.expand(last_key);

            return thing._find(d, paramd);
        }

        attribute = thing.attributed[last_key];
        if (attribute !== undefined) {
            return {
                thing: thing,
                attribute: attribute
            };
        }

        return undefined;
    } else {
        var attributes = self.attributes();
        var matches = [];
        for (var ai = 0; ai < attributes.length; ai++) {
            attribute = attributes[ai];

            var all = true;
            for (var match_key in find_key) {
                /*
                 *  Somewhat hacky - we always ignore '@'
                 *  values and we ignore schema:name (because
                 *  iotdb.make_attribute always adds a name)
                 */
                if (match_key === iot_name) {
                    continue;
                } else if (match_key.indexOf('@') === 0) {
                    continue;
                }

                var match_value = find_key[match_key];
                var attribute_value = attribute[match_key];
                if (_.isArray(attribute_value)) {
                    if (_.isArray(match_value)) {
                        for (var mvi in match_value) {
                            var mv = match_value[mvi];
                            if (attribute_value.indexOf(mv) === -1) {
                                all = false;
                                break;
                            }
                        }
                    } else {
                        if (attribute_value.indexOf(match_value) === -1) {
                            all = false;
                            break;
                        }
                    }
                } else if (match_value !== attribute_value) {
                    all = false;
                    break;
                }
            }

            if (all) {
                matches.push({
                    thing: self,
                    attribute: attribute
                });
            }
        }

        /*
         *  Because there's paired items with the same semantic meaning
         *  e.g. (on / on-value), we have to choose which one we want
         *  if there's multiple choices. I think more work will be needed here
         */
        if (!matches) {
            return undefined;
        } else if (matches.length === 1) {
            return matches[0];
        }

        var match_reading = null;
        var match_control = null;
        for (var mi in matches) {
            var match = matches[mi];
            if (_.ld.contains(match.attribute, iot_role, iot_role_reading)) {
                match_reading = match;
            }
            if (_.ld.contains(match.attribute, iot_role, iot_role_control)) {
                match_control = match;
            }
        }

        if (paramd.set && match_control) {
            return match_control;
        } else if (paramd.get && match_reading) {
            return match_reading;
        } else if (paramd.on && match_reading) {
            return match_reading;
        } else if (match_control) {
            return match_control;
        } else if (match_reading) {
            return match_control;
        } else {
            return matches[0];
        }

        return undefined;
    }

};

/**
 *  Return a Transmogrified version of this Thing.
 */
Model.prototype.transmogrify = function (transmogrifier) {
    return transmogrifier.transmogrify(this);
};

/**
 *  Return an object to access and
 *  manipulate the Metadata.
 */
Model.prototype.meta = function () {
    var self = this;

    if (self.__meta_thing === undefined) {
        self.__meta_thing = new meta_thing.Meta(self);
    }

    return self.__meta_thing;
};

/**
 *  Add a tag to this Model. Tags are temporary
 *  labels, they are not persisted to IOTDB
 *  (or the metadata in general).
 *
 *  @param {string} tag
 */
Model.prototype.tag = function (tag) {
    var self = this;

    assert.ok(_.isString(tag));

    _.ld.add(self.initd, "tag", tag);
};

/**
 */
Model.prototype.reachable = function () {
    var self = this;

    if (self.bridge_instance) {
        return self.bridge_instance.reachable();
    } else {
        return false;
    }
};

/**
 *  Disconnect this Model
 */
Model.prototype.disconnect = function () {
    var self = this;
    var wait = 0;

    if (self.bridge_instance) {
        if (self.bridge_instance.disconnect) {
            wait = self.bridge_instance.disconnect();
        }

        self.bridge_instance = null;
    }

    return wait;
};

/**
 *  Note it's OK if we're already bound - this will just replace it
 */
Model.prototype.bind_bridge = function (bridge_instance) {
    var self = this;

    self.bridge_instance = bridge_instance;
    if (self.bridge_instance) {
        var mapping = self.bridge_instance.binding.mapping;
        self.bridge_instance.pulled = function (pulld) {
            if (pulld) {
                // mappings can be attached to bindings to make enumerations better
                if (mapping !== undefined) {
                    for (var attribute_code in pulld) {
                        var md = mapping[attribute_code];
                        if (md === undefined) {
                            continue;
                        }

                        // reverse lookup in dictionary
                        var attribute_value = pulld[attribute_code];
                        var cattribute_value = _.ld.compact(attribute_value);

                        for (var mkey in md) {
                            var mvalue = md[mkey];
                            if ((mvalue === attribute_value) || (mvalue === cattribute_value)) {
                                pulld[attribute_code] = mkey;
                                break;
                            }
                        }
                    }
                }

                self.update(pulld, {
                    notify: true,
                    push: false,
                    force: false,
                });
            } else {
                self.meta_changed();
            }
        };

        self._identityd = {
            thing_id: self.bridge_instance.meta()["iot:thing"] + ":" + self.code,
        };
    }

    self.meta_changed();

    return self;
};

/*
 *  API
 */
exports.Model = Model;
exports.make_model = make_model;
