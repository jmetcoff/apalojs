/*-------------------------------------------------------------------*/
/*  APALOAPI : Provides a Javascript "class" to access PALO Servers  */
/*-------------------------------------------------------------------*/
//  
//  Copyright (c) 2016 Junction BI, LLC
//  Author: J. Metcoff, Contact: jerry.metcoff@junctionbi.com
//
//  This program is free software: you can redistribute it and/ or modify
//  it under the terms of the GNU General Public License as published by
//  the Free Software Foundation, either version 3 of the License, or
//  (at your option) any later version.
//
//  This program is distributed in the hope that it will be useful,
//  but WITHOUT ANY WARRANTY; without even the implied warranty of
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
//  GNU General Public License for more details.
//
//  You should have received a copy of the GNU General Public License
//  along with this program. If not, see < http://www.gnu.org/licenses/>.
//
//  -------------------------------------------------------------------------
//
//  This is a node.js module which exports a function used as a constructor.
//  The exported function has a prototype used by all new objects to provide
//  PALO server access. There are also several utility functions defined on the 
//  exported function. E.g. "preparesession" will manages a session pool in
//  order to reuse server logins.
//
//  Additional work to be completed:
//  * Convert to Promises for asynchronous request mgmt
//  * Convert to ES6 Classes or Typescript
//  * Create Test suite
//  * Verify/Test: PALO token notifications control caching
//  * Security Model, Improved security for update functions
//  * Complete exception handling (Promises will resolve)
//  * Move string "helper" functions to separate module/class
//  * Allow for case-insensitive element names
//
var http = require('http');

var api = function PALOAPI(svr, port) {
    this.serverHost = svr;
    this.serverPort = port || this.sDefaultPort;
    this.lasterror = "";
    this._sessionid = "";           // Session id returned from server 
    this._timeout = 0;              // Session timeout returned from server (seconds) 
    this._lastreqtime = 0;          // Time when last request sent 
    this._inuse = false;            // True when request is pending/running
    this._reused = false;           // True for first request after re-use
    this._dbtoken = "";             // Database token from latest request
    this._dimtoken = "";            // Dimension token from latest request
    this._cbtoken = "";             // Cube token from latest request
    this._cachemismatch = false;    // True if cached token did not match server response
    
    //  Locate or create the SRVRINFO object:
    var serverKey = this.serverHost.concat(":", this.serverPort);
    this.serverInfo = this.servers[serverKey];
    if (!this.serverInfo) {
        this.serverInfo = new this.SRVRINFO(this.serverHost, this.serverPort);
        this.servers[serverKey] = this.serverInfo;
    }
};

module.exports = api;

api.prototype = {
    
    //  This contains SRVRINFO objects, indexed by "host:port" name:
    servers : {},
    
    
    /*-------------------*/
    /*  Login to server  */
    /*-------------------*/
    
    login : function (username, password, callback) {
        var md5pass = password.substr(0, 2) == "0x";
        var req = this._buildApi("server/login", "user", username, md5pass ? "password" : "extern_password", md5pass ? password.substr(2).toLowerCase() : password);
        var api = this;
        this.serverInfo.activesessions++;
        this._sendRequest(req, function (success, res) {
            if (success) {
                var vals = api._parseResponse(res, ';', 1);
                if (vals && vals.length >= 2) {
                    api._sessionid = vals[0];
                    api._timeout = Number(vals[1]);
                }
                else {
                    success = false;
                }
            }
            if (!success)
                api.serverInfo.activesessions--;
            callback(success);
        });
    },
    
    
    /*----------------------*/
    /*  Logout from server	*/
    /*----------------------*/
    
    logout : function () {
        //  Insure saved session is no longer usable:
        var serverInfo = this.serverInfo;
        if (serverInfo) {
            if (this._sessionid) serverInfo.activesessions--;
            for (var i = 0; i < serverInfo.sessions.length; i++) {
                if (this === serverInfo.sessions[i])
                    serverInfo.sessions[i] = null;
            }
        }
        //  Logout from the server:
        if (this._sessionid) {
            console.log("Logout from PALO Server at " + serverInfo.serverHost + ":" + serverInfo.serverPort);
            var req = this._buildApi("server/logout", "sid", this._sessionid);
            this._sessionid = "";
            this._sendRequest(req, function () { });
        }
        
        if (serverInfo && serverInfo.pendingrequests.length > 0)
            serverInfo.pendingrequests[0].api.afterlogout(serverInfo);
    },
    
    
    /*---------------------------------------------------------*/
    /*  Session complete: Save server session for later reuse  */
    /*---------------------------------------------------------*/
    
    completed : function () {
        var slot = -1;
        for (var i = 0; i < this.serverInfo.sessions.length; i++) {
            if (this.serverInfo.sessions[i] === this)
                break;
            if (this.serverInfo.sessions[i] === null)
                slot = i;
        }
        if (i == this.serverInfo.sessions.length) {
            if (slot < 0) slot = i;
            if (slot >= this.SaveSessionsPerServer) {
                this.logout();
                return;
            }
            this.serverInfo.sessions[slot] = this;
        }
        this._inuse = false;
        if (this.serverInfo.pendingrequests.length > 0)
            this.serverInfo.pendingrequests[0].api.afterlogout(this.serverInfo);
    },
    
    
    /*--------------------------------------------------*/
    /*  getdata - Get data from cell or range of cells  */
    /*  setdata - Set data in a cell or range of cells  */
    /*--------------------------------------------------*/
    //
    //  The supplied options object can have members:
    //  desc - a description that is returned to the caller as the first value for each sub-array.
    //  mult - a multiplier applied to numeric values
    //  dec  - number of digits to right of decimal
    //  form - formatting info for using toLocaleString
    //
    getdata : function (db, cube, dims, res, more /* true if more requests will follow */, opts /* options object */) {
        return this.getsetdata(db, cube, dims, res, null, more, opts);
    },
    
    getsetdata : function (db, cube, dims, res, setvalues, more /* true if more requests will follow */, opts /* options object */) {
        var api = this;
        var nextdim = 0;
        var rangesize = 1;
        var rangeids;
        var elids = new Array(dims.length);
        
        //  Prepare for number formating:
        var localeOpts;
        if (opts) {
            if (opts.nonempty)
                opts.allempty = true;
            if (isFinite(opts.dec)) {
                if (opts.dec < 0 || opts.dec > 10) opts.dec = 0;
                opts.decpow = Math.pow(10, opts.dec);
            }
            if (opts.form) {
                localeOpts = {};
                localeOpts.useGrouping = false;
                if (isFinite(opts.dec))                    
                    localeOpts.minimumFractionDigits = localeOpts.maximumFractionDigits = opts.dec;
                for (var i = 0; i < opts.form.length; i++) {
                    switch (opts.form[i]) {
                        case "$":
                            localeOpts.style = "currency";
                            localeOpts.currency = "USD";
                            break;
                        case ",":
                            localeOpts.useGrouping = true;
                            break;
                        case "%":
                            localeOpts.style = "percent";
                            break;
                        case "(":
                            opts.neginpar = true;
                            break;
                    }
                }
            }
        }
        
        //  Prepare database, then retrieve data in callback:
        this._preparedb(db, res, onready);
        
        //  Function to retrieve data once database is accessed:
        function onready(dba) {
            var cinf = dba.cubes[cube];
            if (!cinf || !cinf.dimensions) {
                return returndberror(dba, "Cube '" + cube + "' is not defined in the database.");
            }
            if (cinf.numDims != dims.length) {
                return returndberror(dba, 'Wrong number of dimension elements supplied (should be ' + cinf.numDims + ')');                
            }
            
            //  Validate that we have all dimensions defined and available. This will result in a callback here as each is retrieved.
            for (var di = nextdim; di < dims.length; di++) {
                var did = cinf.dimensions[di];
                var dinf = (!isNaN(did) && did < dba.dimsById.length) ?  dba.dimsById[did] : null;
                if (!dinf) {
                    return returndberror(dba, "Dimension position " + (di + 1) + " for Cube '" + cube + "' is not defined.");                    
                }
                if (!dinf.elements) {
                    //  Retrieve elements for dimension ...
                    nextdim = di;
                    api._getelements(dba, dinf, null, function (success) {
                        if (success)
                            onready(dba);
                        else {
                            res.status(500).send("Unable to retrieve element list for dimension position " + (nextdim + 1) + ", error: " + api.lasterror);
                            api.completed();
                        }
                    });
                    return;
                }
                
                var elname = api.removeQuotes(dims[di]);
                var element;
                if (elname[0] == '=') {
                    //  Range of elements, will build request for cartesian product of elements
                    elname = elname.substr(1);
                    var subs = api.splitCSVRange(elname);
                    if (!Array.isArray(subs)) {
                        return returndberror(dba, "Error in dimension position " + (di + 1) + ": " + subs);
                    }
                    
                    elname = subs[0];
                    if (opts) opts.headers = subs;
                    rangeids = new Array(subs.length);
                    for (var i = 0; i < subs.length; i++) {
                        element = dinf.elements[subs[i]];
                        if (!element) {
                            return returndberror(dba, "Element '" + subs[i] + "'in dimension position " + (di + 1) + " is not defined.");
                        }
                        rangeids[i] = element["id"];
                    }
                    elids[di] = rangeids;
                    rangesize *= rangeids.length;
                    if (rangesize > 1000) {
                        return returndberror(dba, "There is a maximum of 1000 total elements in a single range request.");
                    }
                }
                else {
                    element = dinf.elements[elname];
                    if (!element) {
                        return returndberror(dba, "Element '" + dims[di] + "'in dimension position " + (di + 1) + " is not defined.");
                    }
                elids[di] = element["id"];
                }
            }
            
            //  All dimensions processed, begin the retrieve process:
            var path;
            if (rangesize == 1) {
                path = elids.toString();
            }
            else {
                //  Need cartesian product
                for (var i = 0; i < elids.length; i++) {
                    if (!Array.isArray(elids[i]))
                        elids[i] = [elids[i]];
                }
                elids = api.cartesianProduct(elids);
                path = "";
                for (var i=0; i<elids.length; i++) {
                    path += (i==0 ? "" : ":") + elids[i].toString();
                }
            }            
            
            var func = setvalues ? (rangeids ? replace_bulk : "replace"): (rangeids ? "values" : "value");
            var saypath = rangeids ? "paths" : "path";
            var req = api._buildApi("cell/" + func, "sid", api._sessionid, "database", dba.dbId, "cube", cinf.cubeId, saypath, path);
            if (setvalues) req = req + api._buildvalues(setvalues);
            var hdrs = cinf.token ? {'x-palo-cb': cinf.token} : {};
            api._sendRequest(req, function (success, resp) {
                var result;
                if (api._cbtoken && cinf.token && cinf.token != api._cbtoken) {
                    // Note: Palo doesn't always return failure as documented.
                    success = false;
                    api._cachemismatch = true;
                }                
                cinf.token = api._cbtoken;
                if (!success && api._cachemismatch) {
                    //  Cached token mismatch:
                    api._resetrequest(dba, res, onready);
                    return;
                }
                if (setvalues)
                    result = "OK";
                else if (success) {
                    result = [];
                    if (opts && opts.desc)
                        result.push(opts.desc);
                    if (rangesize > 1) {
                        var lines = api._parseResponse(resp, '\n', 1);
                        if (lines) {
                            if (lines.length < rangesize) rangesize = line.length;
                            for (var i = 0; i <= rangesize; i++)
                                addreturndata(result, lines[i], i + 1);
                        }
                        else
                            success = false;
                    }
                    else
                        addreturndata(result, resp, 1);
                }
                if (success && result) {
                    res.send((opts || setvalues) ? result : JSON.stringify(result, null, 1) /* Formatting used for demos */);
                    if (!more) api.completed();
                }
                else {
                    res.status(500).send((setvalues ? 'Setdata' : 'Getdata') + ' function failed, error: ' + api.lasterror);
                    api.logout();
                }
            }, hdrs);

        }

        function addreturndata(resp, line, linenum) {
            var vals = api._parseResponse(line, ';', 1);
            if (vals && vals.length >= 2) {
                var valtype = vals[0];
                var valexists = vals[1];
                var result;
                if (valtype == 1) {
                    result = Number(api.removeQuotes(vals[2], false));
                    if (isNaN(result)) {
                        result = vals[2];
                        if (opts && opts.nonempty && result !== '')
                            opts.allempty = false;
                    }
                    else if (opts) {
                        if (opts.nonempty) {
                            if (isFinite(opts.dec))                         
                                result = Math.round(result * opts.decpow) / opts.decpow;                                
                            if (result != 0)
                                opts.allempty = false;
                        }
                        //  Apply formatting to numeric values:
                        if (isFinite(opts.mult))
                            result = result * opts.mult;
                        var addpar = false;
                        if (opts.neginpar && result < 0) {
                            result = -result;
                            addpar = true;
                        }
                        if (localeOpts)
                            result = result.toLocaleString("en-US", localeOpts);
                        else if (isFinite(opts.dec))
                            result = result.toFixed(opts.dec);
                        if (addpar)
                            result = "(" + result + ")";
                    }
                }
                else {
                    result = api.removeQuotes(vals[2], false);
                    if (opts && opts.nonempty && result !== '')
                        opts.allempty = false;
                }
                resp.push(result);
                return resp;
            }
            return null;
        }
        
        //        
        //  Return response error after checking for db changes
        //  This is used when a cube, dim or element is not found, which
        //  could be due to changes on the server that have not yet been
        //  loaded. Server tokens are used to check for old cache data
        //  and the request can be retried.
        //
        function returndberror(dba, msg) {
            if (dba.token) {
                var req = api._buildApi("database/info", "database", dba.dbId.toString(), "sid", api._sessionid);
                var hdrs = { 'x-palo-db': dba.token };
                var rres = res;
                api._sendRequest(req, function (success, res) {
                    if (success && api._dbtoken) {
                        if (dba.token && api._dbtoken != dba.token) {
                            success = false;
                            api._cachemismatch = true;
                        }
                        dba.token = api._dbtoken;
                    }
                    if (!success && api._cachemismatch) {
                        //  Cached token mismatch:
                        api._resetrequest(dba, res, onready);
                    }
                    else {
                        rres.status(400).send(msg);
                        api.completed();
                    }
                }, hdrs);
            }
            else {
                res.status(400).send(msg);
                api.completed();
            }
        }          
    },
        
    
    /*------------------------------------*/
    /*  Prepare for access to a database  */
    /*------------------------------------*/
    
    //  Step 1: Get database information
    _preparedb : function (db, res, onready) {
        var dba;
        db = db.toLowerCase();
        if (this.serverInfo.databases) {
            dba = this.serverInfo.databases[db];
            this._preparedb2(dba, res, onready);
        }
        else {
            var api = this;
            this._getdatabases(function (success) {
                if (success) {
                    dba = api.serverInfo.databases[db];
                    api._preparedb2(dba, res, onready);
                }
                else
                    res.status(500).send('Error ->' + api.lasterror);
            });
        }
    },   
    
    //  Step 2: Load cube list
    _preparedb2 : function (dba, res, onready) {
        if (!dba) {
            res.send(this.sPALODBERROR);
            this.completed();
            return;
        }
        else if (dba.cubes) {
            this._preparedb3(dba, res, onready);
        }
        else {
            var api = this;
            this._getcubes(dba, false, function (success) {
                if (success)
                    api._preparedb3(dba, res, onready);
                else {
                    res.status(500).send('Error ->' + api.lasterror);
                    api.logout();
                }
            });
        }
    },
    
    //  Step 3: Load dimension list
    _preparedb3 : function (dba, res, onready) {
        if (dba.dimensions) {
            onready(dba);
        }
        else {
            var api = this;
            this._getdimensions(dba, false, function (success) {
                if (success)
                    onready(dba);
                else {
                    res.status(500).send('Error ->' + api.lasterror);
                    api.logout();
                }
            });
        }
    },
    
    //  Function to clear cached database information, then reload:
    _resetrequest : function (dba, res, onready) {
        dba.cubes = null;
        dba.dimensions = null;
        dba.dimsById = null;
        this._preparedb(dba.dbName, res, onready);
    },
    

    /*-------------------------------------------------------*/
    /*  Get information for databases defined on the server  */
    /*-------------------------------------------------------*/
    
    _getdatabases : function (callback) {
        var req = this._buildApi("server/databases", "show_normal", "1", "show_system", "0", "show_user_info", "0", "sid", this._sessionid);
        var api = this;
        this._sendRequest(req, function (success, res) {
            if (success) {
                var lines = api._parseResponse(res, '\n', 1);
                if (lines)
                    parselist(lines);
                else
                    success = false;
            }
            callback(success);
        });
        
        function parselist(lines) {
            try {
                api.serverInfo.databases = {};
                for (var i = 0; i < lines.length; i++) {
                    var vals = lines[i].split(";");
                    if (vals.length >= 6) {
                        var id = Number(vals[0]);
                        var name = api.removeQuotes(vals[1], true).toLowerCase();
                        var status = Number(vals[4]);
                        if (!isNaN(id) && !isNaN(status) && id >= 0 && status >= 0) {
                            var dba = new api.DBINFO(name, id);
                            dba.dbStatus = status;
                            api.serverInfo.databases[name] = dba;
                        }
                    }
                }
            }
            catch (e) {

            }
        }
    },    
    

    /*---------------------------------------------------*/
    /*  Get information for cubes defined in a database  */
    /*---------------------------------------------------*/
    
    _getcubes : function (dba, incsystem, callback) {
        var ShowAll = incsystem ? "1" : "0";
        var req = this._buildApi("database/cubes", "database", dba.dbId.toString(), "show_normal", "1", "show_system", ShowAll, "show_attribute", "1", "show_info", ShowAll, "sid", this._sessionid);
        var api = this;
        this._sendRequest(req, function (success, res) {
            if (success) {
                dba.token = api._dbtoken;
                var lines = api._parseResponse(res, '\n', 1);
                if (lines)
                    parselist(lines);
                else
                    success = false;
            }
            callback(success);
        });
        
        function parselist(lines) {
            try {
                dba.cubes = {};
                for (var i = 0; i < lines.length; i++) {
                    var vals = lines[i].split(";");
                    if (vals.length < 3) continue;
                    var id = Number(vals[0]);
                    var name = api.removeQuotes(vals[1], true);
                    var status = vals.length >= 7 ? Number(vals[6]) : 0;
                    if (!isNaN(id) && !isNaN(status) && id >= 0 && status >= 0) {
                        var cube = new api.CUBEINFO(name, id);
                        cube.cubeStatus = status;
                        dba.cubes[name] = cube;
                        cube.numDims = Number(vals[2]);
                        if (isNaN(cube.numDims) || cube.numDims < 0)
                            cube.numDims = 0;
                        var dims = vals[3].split(',');
                        if (dims.length < cube.numDims)
                            cube.numDims = dims.length;
                        cube.dimensions = new Array(cube.numDims);
                        for (var j = 0; j < cube.numDims; j++) {
                            cube.dimensions[j] = Number(dims[j]);
                        }
                    }
                }
            }
            catch (e) {

            }
        }

    },
    
    
    /*--------------------------------------------------------*/
    /*  Get information for dimensions defined in a database  */
    /*--------------------------------------------------------*/
    
    _getdimensions : function (dba, incsystem, callback) {
        var ShowAll = incsystem ? "1" : "0";
        var req = this._buildApi("database/dimensions", "database", dba.dbId.toString(), "show_normal", "1", "show_system", ShowAll, "show_attribute", "1", "show_info", ShowAll, "sid", this._sessionid);
        var api = this;
        this._sendRequest(req, function (success, res) {
            if (success) {
                dba.token = api._dbtoken;
                var lines = api._parseResponse(res, '\n', 1);
                if (lines)
                    parselist(lines);
                else
                    success = false;
            }
            callback(success);
        });
        
        function parselist(lines) {
            try {
                dba.dimensions = {};
                dba.dimsById = [];
                for (var i = 0; i < lines.length; i++) {
                    var vals = lines[i].split(";");
                    if (vals.length < 9) continue;
                    var id = Number(vals[0]);
                    var name = api.removeQuotes(vals[1], true);
                    if (!isNaN(id) && id >= 0) {
                        var dim = new api.DIMINFO(name, id);
                        dba.dimensions[name] = dim;
                        dba.dimsById[id] = dim;
                        dim.numElems = Number(vals[2]);
                        dim.numLevels = Number(vals[3]);
                        dim.dimType = Number(vals[6]);
                        dim.attrId = Number(vals[7]);
                        dim.attrCubeId = Number(vals[8]);
                        if (isNaN(dim.numElems) || dim.numElems < 0)
                            dim.numElems = 0;
                    }
                }
            }
            catch (e) {

            }
        }
    },
    
    
    /* --------------------------------- */
    /* Lookup dimension/cube information */
    /* --------------------------------- */
    //
    //  This function will return a cached CUBEINFO object or null if the server/database
    //  information is not loaded. It will return undefined if the database information 
    //  is loaded but the cube does not exist.
    //
    getCUBEINFO : function (server, port, db, cube) {
        port = port || this.sDefaultPort;
        db = db.toLowerCase();
        var serverKey = server.concat(":", port);
        var serverInfo = this.servers[serverKey];
        if (serverInfo && serverInfo.databases) {
            var dbInfo = serverInfo.databases[db];
            if (!dbInfo) return undefined;
            if (dbInfo.cubes) {
                var cubeinfo = dbInfo.cubes[cube];
                if (!cubeinfo) return undefined;
                return cubeinfo;
            }
        }
        return null;
    },

    //
    //  This function will return a cached DIMINFO object or null if the server/database/dimension 
    //  information is not loaded. It will return undefined if the database, cube, or dimension 
    //  information is loaded but the dimension does not exist.
    //
    getDIMINFO : function (server, port, db, dim) {
        port = port || this.sDefaultPort;
        db = db.toLowerCase();
        var serverKey = server.concat(":", port);
        var serverInfo = this.servers[serverKey];
        if (serverInfo && serverInfo.databases) {
            var dbInfo = serverInfo.databases[db];
            if (!dbInfo) return undefined;
            if (dbInfo.dimensions) {
                var diminfo = dbInfo.dimensions[dim];
                if (!diminfo) return undefined;
                return diminfo;
            }
        }
        return null;
    },
    
    /*-----------------------------------------------*/
    /*  Get information for elements in a dimension  */
    /*-----------------------------------------------*/
    
    getelements : function (server, port, db, dim, parentfilter, res, callback, more) {
        var api = this;
        
        //  Prepare database, then retrieve data in callback:
        this._preparedb(db, res, onready);
        
        //  Function to retrieve data once database is accessed:
        function onready(dba) {
            diminfo = api.getDIMINFO(server, null, db, dim);
            if (!diminfo) { res.status(400).send('Dimension does not exist'); return; }
            
            if (diminfo.elements) {
                callback(diminfo,api);
            }
            else {
                api._getelements(dba, diminfo, null, function (success) {
                    if (success) {
                        if (!more) api.completed();
                        diminfo.token = api._dimtoken;
                        callback(diminfo,api);
                    }
                    else {
                        res.status(500).send("Unable to retrieve element list for dimension '" + dim + "', error: " + api.lasterror);
                        api.completed();
                    }
                });
            }
        }

    },
    
    _getelements : function (dba, dim, parentfilter, callback) {
        var req = this._buildApi("dimension/elements", "sid", this._sessionid, "database", dba.dbId.toString(), "dimension", dim.dimId.toString());
        if (parentfilter)
            req += "&parent=" + parentfilter + "," + (Number(parentfilter) < 0 ? string.Empty : parentfilter);
        var api = this;
        //var hdrs = dim.token ? {'x-palo-dim': dim.token } : {};
        this._sendRequest(req, function (success, res) {
            if (success) {
                var lines = api._parseResponse(res, '\n', 1);
                if (lines)
                    parselist(lines);
                else
                    success = false;
            }
            callback(success);
        });
        
        function parselist(lines) {
            try {
                dim.elements = {};
                dim.elemsById = {};
                dim.parentFilter = parentfilter;
                for (var i = 0; i < lines.length; i++) {
                    var vals = lines[i].split(";");
                    if (vals.length < 7) continue;
                    var elname = api.removeQuotes(vals[1], true);
                    var elId = Number(vals[0]);
                    var elDepth = Number(vals[5]);
                    var elType = Number(vals[6]);
                    if (!isNaN(elId) && elId >= 0) {
                        var elem = { name: elname, id: elId, type: elType, depth: elDepth, childids: vals[10] };
                        dim.elements[elname] = elem;
                        dim.elemsById[elId] = elem;
                    }
                }
            }
            catch (e) {
            }
        }
    },    
    
    
    /*-----------------------------------*/
    /*  Test: Login and wait for return  */
    /*-----------------------------------*/
    
    testwait: function (res, seconds) {
        var api = this;
        setTimeout(function () {
            api.completed();
            res.send("OK");
        }, seconds * 1000);
    },
    
    
    /*----------------------------------------*/
    /*  Private: Build an API request string  */
    /*----------------------------------------*/
    
    _buildApi : function (func) {
        var req = '/' + func;
        var sep = "?";
        for (var i = 1; i < arguments.length; i = i + 2) {
            req = req.concat(sep, arguments[i], "=", arguments[i + 1]);
            sep = "&";
        }
        return req;
    },
    
    /*------------------------------------------------*/
    /*  Private: Build value string for setting cells */
    /*------------------------------------------------*/

    _buildvalues : function (setvalues) {
        var v = setvalues.length == 1 ? "&value=" : "&values=";
        for (var i = 0; i < setvalues.length; i++) {
            if (i > 0) v += ":";
            if (typeof setvalues[i] == "number")
                v += setvalues[i].toString();
            else
                v += encodeURIComponent(setvalues[i]);
        }
        return v;
    },
    
    /*-----------------------------------------*/
    /*  Private: Parse an API response string  */
    /*-----------------------------------------*/
    
    _parseResponse: function (res, sep, mincount) {
        if (res) {
            var values = res.split(sep);
            if (mincount <= 0 || values.length >= mincount)
                return values;
        }
        this.lasterror = this.sPALOAPIERROR1;
        return null;
    },
    
    
    /*-----------------------------*/
    /*  Private: Send API request  */
    /*-----------------------------*/
    
    _sendRequest: function (req, callback, addhdrs) {
        var http = require('http');
        var api = this;
        api._inuse = true;
        api._lastreqtime = Date.now();
        api._cachemismatch = false;
        http.request({ host: this.serverHost, port: this.serverPort, path: req, headers: addhdrs }, function (response) {
            var res = '';
            response.on('data', function (chunk) {
                res += chunk;
            });
            response.on('end', function () {
                api._inuse = false;
                if (response.statusCode == 200) {
                    api._reused = false;
                    api._dbtoken = response.headers['x-palo-db'];
                    api._cbtoken = response.headers['x-palo-cb'];
                    api._dimtoken = response.headers['x-palo-dim'];
                    callback(true, res);
                    return;
                }                                

                //  Request has failed ...
                if (response.statusCode == 400 && res && res.substr(0,5) == '5001;') {
                    //  Cached token mismatch:
                    api._cachemismatch = true;
                }

                if (api._reused && req.substr(0,14)!=="/server/logout") {
                    //  First request after re-used session failed. Retry with new login
                    api._reused = false;
                    api.serverInfo.activesessions--;
                    console.log("Reconnecting to PALO Server at " + api.serverHost + ":" + api.serverPort);
                    api.login(api._reuseUser, api._reusePass, function (success) {
                        if (success) {
                            var beg = req.indexOf("sid=");
                            if (beg > 0) {
                                beg += 4;
                                var end = req.indexOf("&", beg);
                                if (end < 0) end = req.length;
                                req = req.substr(0, beg).concat(api._sessionid, req.substr(end));
                            }
                            api._sendRequest(req, callback);
                        }
                        else {
                            callback(false);
                        }
                    });
                    return;
                }
                //  Request failed:
                api.lasterror = response.statusMessage || "Request failure, status=" + response.statusCode;
                callback(false);
            });
        }).end();
    },
    
    /*  ------------------------------------  */
    /*  Cartesian product of multiple arrays  */
    /*  ------------------------------------  */

    cartesianProduct : function (arr) {
        return arr.reduce(function (a, b) {
            return a.map(function (x) {
                return b.map(function (y) {
                    return x.concat(y);
                })
        }).reduce(function (a, b) { return a.concat(b) }, [])
        }, [[]])
    },
    
    /*  ------------------------------------------------------  */
    /*  Parse a single value or a list of values into an array  */
    /*  ------------------------------------------------------  */
    //
    //  Multiple values are enclosed in square brackets and separated by commas.
    //  Quotes surrounding values are optional and are removed if present.
    //
    parseValueList: function (value) {
        if (!value) return value;
        var retval;
        if (value[0] == '[') {
            value = value.substr(1);
            var nEnd = value.length - 1;
            if (nEnd < 0 || value[nEnd] != ']') return null;
            retval = this.splitCSVRange(value.substr(0, nEnd), ',', '"', null);
        }
        else {
            retval = new Array(1);
            retval[0] = this.removeQuotes(value);
        }
        return retval;
    },


    /*--------------------------------------------------------------------------*/
    /*  Remove any quotes from a string, optionally trimming before and after.  */
    /*--------------------------------------------------------------------------*/
    
    removeQuotes: function (str, trim, quotechar) {
        if (!str) return str;
        trim = trim || false;
        quotechar = quotechar || '"';
        if (trim) str = str.trim();
        if (str.length > 1 && str[0] == quotechar) {
            var nlen = str.length;
            if (str[--nlen] == str[0])
                nlen--;
            str = str.substr(1, nlen);
            if (trim) str = str.trim();
        }
        return str;
    },
    
    
    /*---------------------------------------------------------------------*/
    /*  Parse CSV list combined with range specification, removing quotes  */
    /*---------------------------------------------------------------------*/    
    //
    //  Returns array of elements or single string if parsing error
    //  E.g. this results in 5 returned values: 1,"2",9-"11"
    //  Note: Maximum range is 1000 elements.
    //
    splitCSVRange: function (str, sep, quotechar, dash) {
        sep = sep || ',';
        quotechar = quotechar || '"';
        dash = dash === undefined ? "-" : dash;
        var retval = [];
        var pos = 0;
        var elem, elem1, elem2;
        var next;
        var inrange = false;
        while (pos < str.length) {
            //  skip white space:
            while (pos < str.length && ' \t\n\r\v'.indexOf(str[pos]) > -1)
                ++pos;
            
            //  check for value in quotes:
            if (str[pos] == quotechar) {
                next = str.indexOf(quotechar, ++pos);
                if (next < 0) return "Missing a closing quote";
                elem = str.substr(pos, next - pos);
                pos = ++next;
                while (str[pos] == quotechar) {
                    //  doubling quote generates single character:
                    elem.concat(quotechar);
                    next = str.indexOf(quotechar, ++pos);
                    if (next < 0) return "Missing a closing quote.";
                    elem.concat(str.substr(pos, next - pos));
                    pos = ++next;
                }
                
                //  closed quote, should have separator following:
                while (pos < str.length && ' \t\n\r\v'.indexOf(str[pos]) > -1)
                    ++pos;
                if (pos >= str.length || str[pos] == sep) {
                    ++pos;
                }                    
                else if (!inrange && dash && str[pos] == dash) {
                    //  handle range case ...
                    elem1 = parseInt(elem);
                    inrange = true;
                    pos++;
                    continue;
                }
                else
                    return "Missing separator after quoted string.";
            }

            //  not quoted:
            else {
                next = str.indexOf(sep, pos);
                if (next < 0) next = str.length;
                elem = str.substr(pos, next - pos).trim();
                if (!inrange && dash) {
                    var next1 = elem.indexOf(dash, 1);
                    if (next1 > 0) {
                        inrange = true;
                        elem1 = parseInt(elem.substr(0, next1));
                        pos += ++next1;
                        continue;
                    }
                }
                pos = ++next;
            }
            
            //  add element to results:
            if (inrange) {
                elem2 = parseInt(elem);
                if (isNaN(elem1) || isNaN(elem2) || elem1 > elem2 || elem2 - elem1 > 999)
                    return "Not a valid range: -" + elem;
                for (var el = elem1; el <= elem2; el++)
                    retval[retval.length] = el.toString();
                inrange = false;
            }
            else
                retval[retval.length] = elem;
        }
        return retval;
    }
    
}; // End of prototype definition 


/*------------------------------------------------------*/
/*  Access an available session or start a new session  */
/*------------------------------------------------------*/
//
//  The callback is invoked as soon as login completes.
//  Sessions are kept in a pool until an idle timeout occurs
//
api.preparesession = function (server, port, userid, passwd, callback) {
    port = port || this.prototype.sDefaultPort;
    var serverKey = server.concat(":", port);
    var serverInfo = this.prototype.servers[serverKey];
    var primary = this;
    var api;
    if (serverInfo) {
        for (var i = 0; i < serverInfo.sessions.length; i++) {
            api = serverInfo.sessions[i];
            if (api && !api._inuse) {
                if (Date.now() - api._lastreqtime > (api._timeout - 10) * 1000) {
                    //  Session timeout, cannot be used:
                    api.logout();
                    continue;
                }
                
                //  Reuse idle connection:
                api._inuse = true;
                api._reused = true;
                api._reuseUser = userid;
                api._reusePass = passwd;
                serverInfo.totalrequests++;
                callback(api, true);
                return;
            }            
        }

        if (serverInfo.activesessions >= this.prototype.MaxSessionsPerServer) {
            //  Too many active sessions - queue this request
            serverInfo.pendingrequests.push({ api: primary, server: server, port: port, user: userid, pass: passwd, fn: callback });
            serverInfo.totalqueuedrequests++;
            if (serverInfo.pendingrequests.length > serverInfo.maxpendingrequests)
                serverInfo.maxpendingrequests = serverInfo.pendingrequests.length;
            return;
        }        
    }

    var PALOAPI = this;
    api = new PALOAPI(server, port);
    console.log("Connecting to PALO Server at " + server + ":" + port);
    api.serverInfo.totalrequests++;
    api.login(userid, passwd, function (success) {
        callback(api, success);
    });
};

//  called to dequeue request after logout
api.afterlogout = function (serverInfo) {
    if (serverInfo.pendingrequests.length > 0) {
        var req = serverInfo.pendingrequests.shift();
        req.api.preparesession(req.server, req.port, req.user, req.pass, req.fn);
    }
};


/*-----------------------------------------------------------*/
/*  Handle shutdown gracefully ... close server connections  */
/*-----------------------------------------------------------*/

api.shutdown = function (){    
    var didlogout = false;
    for (var serverKey in this.prototype.servers) {
        var serverInfo = this.prototype.servers[serverKey];
        for (var i = 0; i < serverInfo.sessions.length; i++) {
            api = serverInfo.sessions[i];
            if (api) {
                api.logout();
                didlogout = true;
            }
        }
    }
    return didlogout;
};


/* ------------------------------- */
/* Reset/reload server definitions */
/* ------------------------------- */
//
//  Definitions will be reloaded on the next request to each server/database.
//
api.reset = function (host, db) {
    var lhost = host.length;
    for (var serverKey in this.prototype.servers) {
        if (serverKey.substr(0, lhost) != host) continue;
        var serverInfo = this.prototype.servers[serverKey];
        if (db == "*") {
            serverInfo.databases = null;
        }
        else {
            db = db.toLowerCase();
            var dbInfo = serverInfo.databases[db];
            if (dbInfo) {
                dbInfo.cubes = null;
                dbInfo.dimensions = null;
                dbInfo.dimsById = null;
            }
        }
    }
};


/*---------------------*/
/*  Common properties  */
/*---------------------*/

api.prototype.sPALODBERROR = "The database is not defined on the specified OLAP server.";
api.prototype.sPALOAPIERROR1 = "Unrecognized response from OLAP Server: ";
//  The default port:
api.prototype.sDefaultPort = "7777";
//  Open sessions per server:
api.prototype.MaxSessionsPerServer = 3;
api.prototype.SaveSessionsPerServer = 2;


/*--------------------------------------------------*/
/*  Helper class to encapsulate server information  */
/*--------------------------------------------------*/

api.prototype.SRVRINFO = function (host, port) {
    this.serverHost = host;
    this.serverPort = port || "7777";
    this.databases = null;                      // contains DBINFO objects, indexed by name
    this.sessions = [];                         // pool of open server connections (PALOAPI objects)
    this.activesessions = 0;                    // count of active (inc. idle) server connections
    this.pendingrequests = [];                  // pending request queue
    this.maxpendingrequests = 0;                // maximum pending requests queued 
    this.totalqueuedrequests = 0;               // total pending requests queued 
    this.totalrequests = 0;                     // total issued requests 
};

api.prototype.SRVRINFO.prototype = 
    {

};


/*-----------------------------------------------------------*/
/*  Helper class to encapsulate database access information  */
/*-----------------------------------------------------------*/

api.prototype.DBINFO = function (name, id) {
    if (name) this.dbName = name;
    this.dbId = id || 0;
    this.dbStatus = 0;
    this.token = "";                            // server token for client-caching
    this.cubes = null;                          // contains CUBEINFO objects, indexed by name
    this.dimensions = null;                     // contains DIMINFO objects, indexed by name
    this.dimsById = null;                       // array of DIMINFO objects, indexed by ID 
};

api.prototype.DBINFO.prototype = 
    {
};


/*------------------------------------------------*/
/*  Helper class to encapsulate cube information  */
/*------------------------------------------------*/

api.prototype.CUBEINFO = function (name, id) {
    this.cubeId = id || 0;
    if (name) this.cubeName = name;
    this.cubeStatus = 0;
    this.token = "";                            // server token for client-caching
    this.dimensions = null;                     // array of dimension ids
};

api.prototype.CUBEINFO.prototype = 
    {
};


/*-----------------------------------------------------*/
/*  Helper class to encapsulate dimension information  */
/*-----------------------------------------------------*/

api.prototype.DIMINFO = function (name, id) {
    this.dimId = id || 0;
    if (name) this.dimName = name;
    this.dimType = 0;
    this.numElems = 0;
    this.numLevels = 0;
    this.attrId = 0;
    this.attrCubeId = 0;
    this.elements = null;                   // element objects indexed by name, with attributes: id, type, position, depth, childids
    this.elemsById = null;                  // element objects, indexed by ID 
    this.parentFilter = null;               // starting parent for subset, null if none, -1 if root only. 
    this.token = "";                        // server token for client-caching
};

api.prototype.DIMINFO.prototype = 
    {
};
