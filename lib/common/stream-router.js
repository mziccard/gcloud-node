/*!
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*!
 * @module common/streamrouter
 */

'use strict';

var concat = require('concat-stream');
var streamEvents = require('stream-events');
var through = require('through2');

/**
 * @type {module:common/util}
 * @private
 */
var util = require('../common/util.js');

/*! Developer Documentation
 *
 * streamRouter is used to extend `nextQuery`+callback methods with stream
 * functionality.
 *
 * Before:
 *
 *   search.query('done=true', function(err, results, nextQuery) {});
 *
 * After:
 *
 *   search.query('done=true').on('data', function(result) {});
 *
 * Methods to extend should be written to accept callbacks and return a
 * `nextQuery`. All stream logic is handled in `streamRouter.router_`.
 */
var streamRouter = {};

/**
 * Cache the original method, then overwrite it on the Class's prototype.
 *
 * @param {function} Class - The parent class of the methods to extend.
 * @param {array|string} methodNames - Name(s) of the methods to extend.
 */
streamRouter.extend = function(Class, methodNames) {
  methodNames = util.arrayize(methodNames);

  methodNames.forEach(function(methodName) {
    var originalMethod = Class.prototype[methodName];

    Class.prototype[methodName] = function() {
      var parsedArguments = streamRouter.parseArguments_(arguments);
      return streamRouter.router_(parsedArguments, originalMethod.bind(this));
    };
  });
};

/**
 * Parse a pseudo-array `arguments` for a query and callback.
 *
 * @param {array} args - The original `arguments` pseduo-array that the original
 *     method received.
 */
streamRouter.parseArguments_ = function(args) {
  var query;
  var callback;
  var maxResults = -1;
  var autoPaginate = true;

  var firstArgument = args[0];
  var lastArgument = args[args.length - 1];

  if (util.is(firstArgument, 'function')) {
    callback = firstArgument;
  } else {
    query = firstArgument;
  }

  if (util.is(lastArgument, 'function')) {
    callback = lastArgument;
  }

  if (util.is(query, 'object')) {
    // Check if the user only asked for a certain amount of results.
    if (util.is(query.maxResults, 'number')) {
      // `maxResults` is used API-wide.
      maxResults = query.maxResults;
    } else if (util.is(query.limitVal, 'number')) {
      // `limitVal` is part of a Datastore query.
      maxResults = query.limitVal;
    } else if (util.is(query.pageSize, 'number')) {
      // `pageSize` is Pub/Sub's `maxResults`.
      maxResults = query.pageSize;
    }

    if (callback &&
        (maxResults !== -1 || // The user specified a limit.
        query.autoPaginate === false ||
        query.autoPaginateVal === false)) {
      autoPaginate = false;
    }
  }

  return {
    query: query || {},
    callback: callback,
    maxResults: maxResults,
    autoPaginate: autoPaginate
  };
};

/**
 * The router accepts a query and callback that were passed to the overwritten
 * method. If there's a callback, simply pass the query and/or callback through
 * to the original method. If there isn't a callback. stream mode is activated.
 *
 * @param {array} parsedArguments - Parsed arguments from the original method
 *     call.
 * @param {object=|string=} parsedArguments.query - Query object. This is most
 *     commonly an object, but to make the API more simple, it can also be a
 *     string in some places.
 * @param {function=} parsedArguments.callback - Callback function.
 * @param {boolean} parsedArguments.autoPaginate - Auto-pagination enabled.
 * @param {number} parsedArguments.maxResults - Maximum results to return.
 * @param {function} originalMethod - The cached method that accepts a callback
 *     and returns `nextQuery` to receive more results.
 * @return {undefined|stream}
 */
streamRouter.router_ = function(parsedArguments, originalMethod) {
  var query = parsedArguments.query;
  var callback = parsedArguments.callback;
  var autoPaginate = parsedArguments.autoPaginate;

  if (callback) {
    if (autoPaginate) {
      this.runAsStream_(parsedArguments, originalMethod)
        .on('error', callback)
        .pipe(concat(function(results) {
          callback(null, results);
        }));
    } else {
      originalMethod(query, callback);
    }
  } else {
    return this.runAsStream_(parsedArguments, originalMethod);
  }
};

/**
 * This method simply calls the nextQuery recursively, emitting results to a
 * stream. The stream ends when `nextQuery` is null.
 *
 * `maxResults` and `limitVal` (from Datastore) will act as a cap for how many
 * results are fetched and emitted to the stream.
 *
 * @param {object=|string=} parsedArguments.query - Query object. This is most
 *     commonly an object, but to make the API more simple, it can also be a
 *     string in some places.
 * @param {function=} parsedArguments.callback - Callback function.
 * @param {boolean} parsedArguments.autoPaginate - Auto-pagination enabled.
 * @param {number} parsedArguments.maxResults - Maximum results to return.
 * @param {function} originalMethod - The cached method that accepts a callback
 *     and returns `nextQuery` to receive more results.
 * @return {stream} - Readable object stream.
 */
streamRouter.runAsStream_ = function(parsedArguments, originalMethod) {
  var query = parsedArguments.query;
  var resultsToSend = parsedArguments.maxResults;

  var stream = streamEvents(through.obj());

  // Results from the API are split apart for the user. If 50 results are
  // returned, we emit 50 data events. While the user is consuming these, they
  // might choose to end the stream early by calling ".end()". We keep track of
  // this state to prevent pushing more results to the stream, ending it again,
  // or making unnecessary API calls.
  var streamEnded = false;
  var _end = stream.end;
  stream.end = function() {
    streamEnded = true;
    _end.apply(this, arguments);
  };

  function onResultSet(err, results, nextQuery) {
    if (err) {
      stream.emit('error', err);
      stream.end();
      return;
    }

    var result;
    while ((result = results.shift()) && resultsToSend !== 0 && !streamEnded) {
      stream.push(result);
      resultsToSend--;
    }

    if (streamEnded) {
      return;
    }

    if (resultsToSend === 0) {
      stream.end();
      return;
    }

    if (nextQuery) {
      originalMethod(nextQuery, onResultSet);
    } else {
      stream.end();
    }
  }

  stream.once('reading', function() {
    originalMethod(query, onResultSet);
  });

  return stream;
};

module.exports = streamRouter;
