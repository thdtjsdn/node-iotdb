/*
 *  definitions.js
 *
 *  David Janes
 *  IOTDB.org
 *  2015-01-17
 *
 *  Precooked definitions
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

var iotdb = require('iotdb')

/*
 *  Version 0.4 - explicit declarations
 *
 *  These are all available in IOTDB as a top
 *  level export (i.e. iotdb.boolean.mute)
 */
var attribute = {};
exports.attribute = attribute;

/* boolean */
attribute.boolean = iotdb.make_boolean(":value");
attribute.boolean.on = iotdb.make_boolean(":on");
attribute.boolean.mute = iotdb.make_boolean(":mute");

/* integer */
attribute.integer = iotdb.make_integer(":value")
attribute.integer.percent = iotdb.make_integer(":value")
    .minimum(0)
    .maximum(100)
    .unit("iot-unit:math.fraction.percent");
attribute.integer.channel = iotdb.make_integer(":value")
    .minimum(1);

/* numbers */
attribute.number = iotdb.make_number(":value");
attribute.number.temperature = iotdb.make_number(":temperature");
attribute.number.temperature.celsius = iotdb.make_number(":temperature")
    .unit("iot-unit:temperature.metric.celsius");
attribute.number.fahrenheit = iotdb.make_number(":temperature")
    .unit("iot-unit:temperature.imperial.fahrenheit");
attribute.number.temperature.kelvin = iotdb.make_number(":temperature")
    .unit("iot-unit:temperature.metric.kelvin");

attribute.percent = iotdb.make_percent(":value")
attribute.percent.volume = iotdb.make_percent(":volume")
attribute.percent.brightness = iotdb.make_percent(":brightness")

attribute.unit = iotdb.make_unit(":value");
attribute.unit.volume = iotdb.make_unit(":volume");
attribute.unit.brightness = iotdb.make_unit(":brightness");

/* strings */
attribute.string = iotdb.make_string(":value");
attribute.string.color = iotdb.make_color(":color");
attribute.string.band = iotdb.make_string(":band");

/* vectors */
attribute.vector = {};
attribute.vector.number = {};
attribute.vector.number.xyz = {
    x: iotdb.make_number(':x').vector("x/y/z"),
    y: iotdb.make_number(':y').vector("x/y/z"),
    z: iotdb.make_number(':z').vector("x/y/z"),
};
attribute.vector.number.axes = {
    roll: iotdb.make_number(':roll').vector("roll/pitch/yaw"),
    pitch: iotdb.make_number(':pitch').vector("roll/pitch/yaw"),
    yaw: iotdb.make_number(':yaw').vector("roll/pitch/yaw"),
};

/* sensors */
attribute.sensor = {};

/* sensor: numbers */
attribute.sensor.number = {};
attribute.sensor.number.battery = iotdb.make_number(':sensor.battery')
attribute.sensor.number.fire = iotdb.make_number(':sensor.fire');
attribute.sensor.number.heat = iotdb.make_number(':sensor.heat');
attribute.sensor.number.chemical = iotdb.make_number(':sensor.chemical');
attribute.sensor.number.chemical.co2 = iotdb.make_number(':sensor.chemical.carbon-dioxide');
attribute.sensor.number.chemical.co = iotdb.make_number(':sensor.chemical.carbon-monoxide');
attribute.sensor.number.contact = iotdb.make_number(':sensor.contact');
attribute.sensor.number.motion = iotdb.make_number(':sensor.motion');
attribute.sensor.number.open = iotdb.make_number(':sensor.open');
attribute.sensor.number.presence = iotdb.make_number(':sensor.presence');
attribute.sensor.number.particulates = iotdb.make_number(':sensor.particulates');
attribute.sensor.number.shatter = iotdb.make_number(':sensor.shatter');
attribute.sensor.number.temperature = iotdb.make_number(":sensor.temperature")
attribute.sensor.number.temperature.celsius = iotdb.make_number(":sensor.temperature")
    .unit("iot-unit:temperature.metric.celsius");
attribute.sensor.number.temperature.fahrenheit = iotdb.make_number(":sensor.temperature")
    .unit("iot-unit:temperature.imperial.fahrenheit");
attribute.sensor.number.temperature.kelvin = iotdb.make_number(":sensor.temperature")
    .unit("iot-unit:temperature.metric.kelvin");
attribute.sensor.number.humidty = iotdb.make_number(':sensor.humidty');
attribute.sensor.number.sound = iotdb.make_number(':sensor.sound');
attribute.sensor.number.water = iotdb.make_number(':sensor.water');
attribute.sensor.number.humidity = iotdb.make_number(':sensor.humidity')

/* sensor: booleans */
attribute.sensor.boolean = {};
attribute.sensor.boolean.battery = iotdb.make_boolean(':sensor.battery')
attribute.sensor.boolean.fire = iotdb.make_boolean(':sensor.fire');
attribute.sensor.boolean.heat = iotdb.make_boolean(':sensor.heat');
attribute.sensor.boolean.chemical = iotdb.make_boolean(':sensor.chemical');
attribute.sensor.boolean.chemical.co2 = iotdb.make_boolean(':sensor.chemical.carbon-dioxide');
attribute.sensor.boolean.chemical.co = iotdb.make_boolean(':sensor.chemical.carbon-monoxide');
attribute.sensor.boolean.contact = iotdb.make_boolean(':sensor.contact');
attribute.sensor.boolean.motion = iotdb.make_boolean(':sensor.motion');
attribute.sensor.boolean.open = iotdb.make_boolean(':sensor.open');
attribute.sensor.boolean.presence = iotdb.make_boolean(':sensor.presence');
attribute.sensor.boolean.particulates = iotdb.make_boolean(':sensor.particulates');
attribute.sensor.boolean.shatter = iotdb.make_boolean(':sensor.shatter');
attribute.sensor.boolean.temperature = iotdb.make_boolean(":sensor.temperature")
attribute.sensor.boolean.humidty = iotdb.make_boolean(':sensor.humidty');
attribute.sensor.boolean.sound = iotdb.make_boolean(':sensor.sound');
attribute.sensor.boolean.water = iotdb.make_boolean(':sensor.water');
attribute.sensor.boolean.humidity = iotdb.make_boolean(':sensor.humidity')

/* sensor: unit (0-1) */
attribute.sensor.unit = {};
attribute.sensor.unit.battery = iotdb.make_unit(':sensor.battery')
attribute.sensor.unit.fire = iotdb.make_unit(':sensor.fire');
attribute.sensor.unit.heat = iotdb.make_unit(':sensor.heat');
attribute.sensor.unit.chemical = iotdb.make_unit(':sensor.chemical');
attribute.sensor.unit.chemical.co2 = iotdb.make_unit(':sensor.chemical.carbon-dioxide');
attribute.sensor.unit.chemical.co = iotdb.make_unit(':sensor.chemical.carbon-monoxide');
attribute.sensor.unit.contact = iotdb.make_unit(':sensor.contact');
attribute.sensor.unit.motion = iotdb.make_unit(':sensor.motion');
attribute.sensor.unit.open = iotdb.make_unit(':sensor.open');
attribute.sensor.unit.presence = iotdb.make_unit(':sensor.presence');
attribute.sensor.unit.particulates = iotdb.make_unit(':sensor.particulates');
attribute.sensor.unit.shatter = iotdb.make_unit(':sensor.shatter');
attribute.sensor.unit.temperature = iotdb.make_unit(":sensor.temperature")
attribute.sensor.unit.humidty = iotdb.make_unit(':sensor.humidty');
attribute.sensor.unit.sound = iotdb.make_unit(':sensor.sound');
attribute.sensor.unit.water = iotdb.make_unit(':sensor.water');
attribute.sensor.unit.humidity = iotdb.make_unit(':sensor.humidity')

/* sensor: percent (0-100) */
attribute.sensor.percent = {};
attribute.sensor.percent.battery = iotdb.make_percent(':sensor.battery')
attribute.sensor.percent.fire = iotdb.make_percent(':sensor.fire');
attribute.sensor.percent.heat = iotdb.make_percent(':sensor.heat');
attribute.sensor.percent.chemical = iotdb.make_percent(':sensor.chemical');
attribute.sensor.percent.chemical.co2 = iotdb.make_percent(':sensor.chemical.carbon-dioxide');
attribute.sensor.percent.chemical.co = iotdb.make_percent(':sensor.chemical.carbon-monoxide');
attribute.sensor.percent.contact = iotdb.make_percent(':sensor.contact');
attribute.sensor.percent.motion = iotdb.make_percent(':sensor.motion');
attribute.sensor.percent.open = iotdb.make_percent(':sensor.open');
attribute.sensor.percent.presence = iotdb.make_percent(':sensor.presence');
attribute.sensor.percent.particulates = iotdb.make_percent(':sensor.particulates');
attribute.sensor.percent.shatter = iotdb.make_percent(':sensor.shatter');
attribute.sensor.percent.temperature = iotdb.make_percent(":sensor.temperature")
attribute.sensor.percent.humidty = iotdb.make_percent(':sensor.humidty');
attribute.sensor.percent.sound = iotdb.make_percent(':sensor.sound');
attribute.sensor.percent.water = iotdb.make_percent(':sensor.water');
attribute.sensor.percent.humidity = iotdb.make_percent(':sensor.humidity')