/*!
 * Copyright 2014 Google Inc. All Rights Reserved.
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
 * @module bigquery
 */

'use strict';

var extend = require('extend');

/**
 * @type {module:bigquery/dataset}
 * @private
 */
var Dataset = require('./dataset.js');

/**
 * @type {module:bigquery/job}
 * @private
 */
var Job = require('./job.js');

/**
 * @type {module:common/streamrouter}
 * @private
 */
var streamRouter = require('../common/stream-router.js');

/**
 * @type {module:bigquery/table}
 * @private
 */
var Table = require('./table.js');

/**
 * @type {module:common/util}
 * @private
 */
var util = require('../common/util.js');

/**
 * @const {string} Base URL for the BigQuery API.
 * @private
 */
var BIGQUERY_BASE_URL = 'https://www.googleapis.com/bigquery/v2/projects/';

/**
 * Required scopes for Google Cloud BigQuery API.
 *
 * @const {array}
 * @private
 */
var SCOPES = ['https://www.googleapis.com/auth/bigquery'];

/**
 * The examples below will demonstrate the different usage patterns your app may
 * need to support to retrieve a BigQuery object.
 *
 * @alias module:bigquery
 * @constructor
 *
 * @param {object} options - [Configuration object](#/docs/?method=gcloud).
 *
 * @example
 * var gcloud = require('gcloud')({
 *   keyFilename: '/path/to/keyfile.json',
 *   projectId: 'my-project'
 * });
 *
 * var bigquery = gcloud.bigquery();
 *
 * //-
 * // In the following examples from this page and the other modules (Dataset,
 * // Table, etc.), we are going to be using a dataset from
 * // data.gov (http://goo.gl/f2SXcb) of higher education institutions.
 * //
 * // We will create a table with the correct schema, import the public CSV file
 * // into that table, and query it for data.
 * //-
 */
function BigQuery(options) {
  if (!(this instanceof BigQuery)) {
    return new BigQuery(options);
  }

  options = options || {};

  if (!options.projectId) {
    throw util.missingProjectIdError;
  }

  this.makeAuthorizedRequest_ = util.makeAuthorizedRequestFactory({
    credentials: options.credentials,
    keyFile: options.keyFilename,
    scopes: SCOPES,
    email: options.email
  });

  this.projectId = options.projectId;
}

/**
 * Create a dataset.
 *
 * @param {string} id - ID of the dataset to create.
 * @param {function} callback  - The callback function.
 *
 * @example
 * bigquery.createDataset('my-dataset', function(err, dataset, apiResponse) {});
 */
BigQuery.prototype.createDataset = function(id, callback) {
  var that = this;

  var body = {
    datasetReference: {
      datasetId: id
    }
  };

  this.makeReq_('POST', '/datasets', null, body, function(err, resp) {
    if (err) {
      callback(err, null, resp);
      return;
    }

    var dataset = that.dataset(id);
    dataset.metadata = resp;

    callback(null, dataset, resp);
  });
};

/**
 * Create a reference to an existing dataset.
 *
 * @param {string} id - ID of the dataset.
 * @return {module:bigquery/dataset}
 *
 * @example
 * var dataset = bigquery.dataset('higher_education');
 */
BigQuery.prototype.dataset = function(id) {
  return new Dataset(this, id);
};

/**
 * List all or some of the datasets in your project.
 *
 * @param {object=} query - Configuration object.
 * @param {boolean} query.all - List all datasets, including hidden ones.
 * @param {boolean} query.autoPaginate - Have pagination handled automatically.
 *     Default: true.
 * @param {number} query.maxResults - Maximum number of results to return.
 * @param {string} query.pageToken - Token returned from a previous call, to
 *     request the next page of results.
 * @param {function} callback - The callback function.
 *
 * @example
 * bigquery.getDatasets(function(err, datasets) {
 *   if (!err) {
 *     // datasets is an array of Dataset objects.
 *   }
 * });
 *
 * //-
 * // To control how many API requests are made and page through the results
 * // manually, set `autoPaginate` to `false`.
 * //-
 * var callback = function(err, datasets, nextQuery, apiResponse) {
 *   if (nextQuery) {
 *     // More results exist.
 *     bigquery.getDatasets(nextQuery, callback);
 *   }
 * };
 *
 * bigquery.getDatasets({
 *   autoPaginate: false
 * }, callback);
 *
 * //-
 * // Get the datasets from your project as a readable object stream.
 * //-
 * bigquery.getDatasets()
 *   .on('error', console.error)
 *   .on('data', function(dataset) {
 *     // dataset is a Dataset object.
 *   })
 *   .on('end', function() {
 *     // All datasets retrieved.
 *   });
 *
 * //-
 * // If you anticipate many results, you can end a stream early to prevent
 * // unnecessary processing and API requests.
 * //-
 * bigquery.getDatasets()
 *   .on('data', function(dataset) {
 *     this.end();
 *   });
 */
BigQuery.prototype.getDatasets = function(query, callback) {
  var that = this;

  if (util.is(query, 'function')) {
    callback = query;
    query = {};
  }

  query = query || {};

  this.makeReq_('GET', '/datasets', query, null, function(err, resp) {
    if (err) {
      callback(err, null, null, resp);
      return;
    }

    var nextQuery = null;

    if (resp.nextPageToken) {
      nextQuery = extend({}, query, {
        pageToken: resp.nextPageToken
      });
    }

    var datasets = (resp.datasets || []).map(function(dataset) {
      var ds = that.dataset(dataset.datasetReference.datasetId);
      ds.metadata = dataset;
      return ds;
    });

    callback(null, datasets, nextQuery, resp);
  });
};

/**
 * Get all of the jobs from your project.
 *
 * @param {object=} options - Configuration object.
 * @param {boolean=} options.allUsers - Display jobs owned by all users in the
 *     project.
 * @param {boolean} options.autoPaginate - Have pagination handled
 *     automatically. Default: true.
 * @param {number=} options.maxResults - Maximum number of results to return.
 * @param {string=} options.pageToken - Token returned from a previous call, to
 *     request the next page of results.
 * @param {string=} options.projection - Restrict information returned to a set
 *     of selected fields. Acceptable values are "full", for all job data, and
 *     "minimal", to not include the job configuration.
 * @param {string=} options.stateFilter - Filter for job state. Acceptable
 *     values are "done", "pending", and "running".
 * @param {function} callback - The callback function.
 *
 * @example
 * bigquery.getJobs(function(err, jobs) {
 *   if (!err) {
 *     // jobs is an array of Job objects.
 *   }
 * });
 *
 * //-
 * // To control how many API requests are made and page through the results
 * // manually, set `autoPaginate` to `false`.
 * //-
 * var callback = function(err, jobs, nextQuery, apiRespose) {
 *   if (nextQuery) {
 *     // More results exist.
 *     bigquery.getJobs(nextQuery, callback);
 *   }
 * };
 *
 * bigquery.getJobs({
 *   autoPaginate: false
 * }, callback);
 *
 * //-
 * // Get the jobs from your project as a readable object stream.
 * //-
 * bigquery.getJobs()
 *   .on('error', console.error)
 *   .on('data', function(job) {
 *     // job is a Job object.
 *   })
 *   .on('end', function() {
 *     // All jobs retrieved.
 *   });
 *
 * //-
 * // If you anticipate many results, you can end a stream early to prevent
 * // unnecessary processing and API requests.
 * //-
 * bigquery.getJobs()
 *   .on('data', function(job) {
 *     this.end();
 *   });
 */
BigQuery.prototype.getJobs = function(options, callback) {
  var that = this;

  if (util.is(options, 'function')) {
    callback = options;
    options = {};
  }

  options = options || {};

  this.makeReq_('GET', '/jobs', options, null, function(err, resp) {
    if (err) {
      callback(err, null, null, resp);
      return;
    }

    var nextQuery = null;

    if (resp.nextPageToken) {
      nextQuery = extend({}, options, {
        pageToken: resp.nextPageToken
      });
    }

    var jobs = (resp.jobs || []).map(function(jobObject) {
      var job = that.job(jobObject.id);
      job.metadata = jobObject;
      return job;
    });

    callback(null, jobs, nextQuery, resp);
  });
};

/**
 * Create a reference to an existing Job.
 *
 * @param {string} id - ID of the job.
 * @return {module:bigquery/job}
 *
 * @example
 * var myExistingJob = bigquery.job('job-id');
 */
BigQuery.prototype.job = function(id) {
  return new Job(this, id);
};

/**
 * Run a query scoped to your project.
 *
 * If you provide a callback, this method returns the results from your query to
 * it. When querying large sets of data, it is possible your results won't be
 * returned all at once. In those cases, you will receive a third argument to
 * your callback that can be passed back to this method to return more results.
 *
 * See the examples below for such a workflow.
 *
 * This method also runs as a readable stream if you do not provide a callback.
 * In cases where more results exist, this will automatically run the subsequent
 * queries for you, pushing each row to the stream.
 *
 * @param {string|object} options - A string SQL query or configuration object.
 * @param {boolean} options.autoPaginate - Have pagination handled
 *     automatically. Default: true.
 * @param {number} options.maxResults - Maximum number of results to read.
 * @param {string} options.query - A query string, following the BigQuery query
 *     syntax, of the query to execute.
 * @param {number} options.timeoutMs - How long to wait for the query to
 *     complete, in milliseconds, before returning. Default is to return
 *     immediately. If the timeout passes before the job completes, the request
 *     will fail with a `TIMEOUT` error.
 * @param {function=} callback - The callback function.
 *
 * @example
 * var query = 'SELECT url FROM [publicdata:samples.github_nested] LIMIT 100';
 *
 * bigquery.query(query, function(err, rows) {
 *   if (!err) {
 *     // Handle results here.
 *   }
 * });
 *
 * //-
 * // To control how many API requests are made and page through the results
 * // manually, set `autoPaginate` to `false`.
 * //-
 * var callback = function(err, rows, nextQuery, apiResponse) {
 *   if (nextQuery) {
 *     bigquery.query(nextQuery, callback);
 *   }
 * };
 *
 * bigquery.query({
 *   query: query,
 *   autoPaginate: false
 * }, callback);
 *
 * //-
 * // You can also use the `query` method as a readable object stream by
 * // omitting the callback.
 * //-
 * bigquery.query(query)
 *   .on('error', console.error)
 *   .on('data', function(row) {
 *     // row is a result from your query.
 *   })
 *   .on('end', function() {
 *     // All rows retrieved.
 *   });
 */
BigQuery.prototype.query = function(options, callback) {
  var that = this;

  if (util.is(options, 'string')) {
    options = {
      query: options
    };
  }

  options = options || {};

  var job = options.job;

  var requestQuery = extend({}, options);
  delete requestQuery.job;

  if (job) {
    // Get results of the query.
    var path = '/queries/' + job.id;
    that.makeReq_('GET', path, requestQuery, null, responseHandler);
  } else {
    // Create a job.
    that.makeReq_('POST', '/queries', null, options, responseHandler);
  }

  function responseHandler(err, resp) {
    if (err) {
      callback(err, null, null, resp);
      return;
    }

    var rows = [];
    if (resp.schema && resp.rows) {
      rows = Table.mergeSchemaWithRows_(resp.schema, resp.rows);
    }

    var nextQuery = null;
    if (resp.jobComplete === false) {
      // Query is still running.
      nextQuery = extend({}, options);
    } else if (resp.pageToken) {
      // More results exist.
      nextQuery = extend({}, options, {
        pageToken: resp.pageToken
      });
    }
    if (nextQuery && !nextQuery.job && resp.jobReference.jobId) {
      // Create a prepared Job to continue the query.
      nextQuery.job = that.job(resp.jobReference.jobId);
    }

    callback(null, rows, nextQuery, resp);
  }
};

/**
 * Run a query as a job. No results are immediately returned. Instead, your
 * callback will be executed with a {module:bigquery/job} object that you must
 * ping for the results. See the Job documentation for explanations of how to
 * check on the status of the job.
 *
 * @param {object|string} options - The configuration object. This must be in
 *     the format of the [`configuration.query`](http://goo.gl/wRpHvR) property
 *     of a Jobs resource. If a string is provided, this is used as the query
 *     string, and all other options are defaulted.
 * @param {module:bigquery/table=} options.destination - The table to save the
 *     query's results to. If omitted, a new table will be created.
 * @param {string} options.query - A query string, following the BigQuery query
 *     syntax, of the query to execute.
 * @param {function} callback - The callback function.
 *
 * @throws {Error} If a query is not specified.
 * @throws {Error} If a Table is not provided as a destination.
 *
 * @example
 * var query = 'SELECT url FROM [publicdata:samples.github_nested] LIMIT 100';
 *
 * //-
 * // You may pass only a query string, having a new table created to store the
 * // results of the query.
 * //-
 * bigquery.startQuery(query, function(err, job) {});
 *
 * //-
 * // You can also control the destination table by providing a
 * // {module:bigquery/table} object.
 * //-
 * bigquery.startQuery({
 *   destination: bigquery.dataset('higher_education').table('institutions'),
 *   query: query
 * }, function(err, job) {});
 *
 * //-
 * // After you have run `startQuery`, your query will execute in a job. Your
 * // callback is executed with a {module:bigquery/job} object so that you may
 * // check for the results.
 * //-
 * bigquery.startQuery(query, function(err, job) {
 *   if (!err) {
 *     job.getQueryResults(function(err, rows, apiResponse) {});
 *   }
 * });
 */
BigQuery.prototype.startQuery = function(options, callback) {
  var that = this;

  if (util.is(options, 'string')) {
    options = {
      query: options
    };
  }

  options = options || {};

  if (!options.query) {
    throw new Error('A SQL query string is required.');
  }

  var defaults = {};

  if (options.destination) {
    if (!(options.destination instanceof Table)) {
      throw new Error('Destination must be a Table object.');
    }
    defaults.destinationTable = {
      datasetId: options.destination.dataset.id,
      projectId: options.destination.dataset.bigQuery.projectId,
      tableId: options.destination.id
    };
    delete options.destination;
  }

  var body = {
    configuration: {
      query: extend(true, defaults, options)
    }
  };

  this.makeReq_('POST', '/jobs', null, body, function(err, resp) {
    if (err) {
      callback(err, null, resp);
      return;
    }

    var job = that.job(resp.jobReference.jobId);
    job.metadata = resp;

    callback(null, job, resp);
  });
};

/**
 * Make a new request object from the provided arguments and wrap the callback
 * to intercept non-successful responses.
 *
 * @private
 *
 * @param {string} method - Action.
 * @param {string} path - Request path.
 * @param {*} query - Request query object.
 * @param {*} body - Request body contents.
 * @param {function} callback - The callback function.
 */
BigQuery.prototype.makeReq_ = function(method, path, query, body, callback) {
  var reqOpts = {
    method: method,
    qs: query,
    uri: BIGQUERY_BASE_URL + this.projectId + path
  };

  if (body) {
    reqOpts.json = body;
  }

  this.makeAuthorizedRequest_(reqOpts, callback);
};

/*! Developer Documentation
 *
 * These methods can be used with either a callback or as a readable object
 * stream. `streamRouter` is used to add this dual behavior.
 */
streamRouter.extend(BigQuery, ['getDatasets', 'getJobs', 'query']);

module.exports = BigQuery;
