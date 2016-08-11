/*------------------------------------------*/
/*  APALOREQS : APALOJS Request Processing  */
/*------------------------------------------*/
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
//  ---------------------------------------------------------------------

var fs = require('fs');
var PALOAPI = require('../process/apaloapi');

var reqs = {
    
    /*-----------------------------------------------------*/
    /* GET /data = access palo data cell or range of cells */
    /*-----------------------------------------------------*/
    //
    //  Query parameters for GET request are:
    //  db   = Database name
    //  cube = Cube name
    //  dims = list of dimension values, semicolon separated and quoted as needed
    //
    //  One or more of the dimensions can be a comma-separated list or a range specification
    //  or a combination of these. Use a leading "=" in this case. Ranges only work for numeric 
    //  element names. E.g. you might have an end of month element and also a range of days:
    //      ="31 MTD",1-31
    //
    //  When multiple ranges are supplied, the returned array is the cartesian product of the
    //  input ranges (rightmost element varies first).
    //
    //  The return value is an array in JSON, i.e. square brackets ([...]), or an error message
    //  string (if not in square brackets and with a status other than 200).
    //
    Get_Data: function (req, res) {
        if (!req.query.db) { res.status(400).send('Missing db parameter'); return; }
        if (!req.query.cube) { res.status(400).send('Missing cube parameter'); return; }
        if (!req.query.dims) { res.status(400).send('Missing dims parameter'); return; }
        
        var app = req.app;
        if (app.locals.shutdown === "Y") { res.status(500).send('Server is shut down'); return; }

        var cube = PALOAPI.prototype.removeQuotes(req.query.cube);
        var db = PALOAPI.prototype.removeQuotes(req.query.db);
        if (Array.isArray(app.locals.palo_allowdatabases) && app.locals.palo_allowdatabases.indexOf(db) < 0) {
            res.status(400).send('The requested database is not permitted for this application.'); return;   
        }
        
        var server = app.locals.palo_server;
        var userid = app.locals.palo_userid;
        var passwd = app.locals.palo_passwd;
        
        PALOAPI.preparesession(server, null, userid, passwd, function (api, success) {
            if (success) {
                var cube = api.removeQuotes(req.query.cube);
                var db = api.removeQuotes(req.query.db);
                var dims = req.query.dims.match(/("[^"]*")|[^;]+/g);
                api.getdata(db, cube, dims, res);
            }
            else {
                res.status(500).send('Server login failed ->' + api.lasterror);
            }
        });
    },
    
    
    /*-------------------------------------------------------------------------------------------------*/
    /* GET /table - retrieve table of cells using either dimension children or a local definition file */
    /*-------------------------------------------------------------------------------------------------*/
    //
    //  This request retrieves a table in one of two formats. It can either expand a dimension to 
    //  return children in additional rows or it can read pre-defined dimension values from a local
    //  definition file.
    //
    //  Common query parameters for the GET request are:
    //  db   = Database name
    //  cube = Cube name
    //  dims = list of dimension values, semicolon separated and quoted as needed
    //  headers = add elements header row, this is string put at front if row descriptions
    //            are used (if not, the value of this string is ignored).
    //    
    //  The return value is an array of arrays, each sub-array representing one row in the expansion or 
    //  one line in the definition file or . This is JSON-compatible formatting.
    //
    //  See "/getdata" for additional information.
    //
    //  Query Format #1:
    //
    //      expand = Dimension name to expand. The parent element is in the "dims" list.
    //      level  = Number of levels to expand
    //      indent = Number of spaces to add in descriptions for each level
    //      nonempty = 1/true to supress empty/zero rows (except for first)
    //      numberformat = numeric format specification. First character is # of decimal places.
    //                     additional characters following are:
    //                      "$" to format as currency
    //                      "%" to format as percentage
    //                      "," to use 1000's separators
    //                      "(" to format negative numbers in parenthesis
    //                      Note: When this formatting is used, converted string values are 
    //                      returned instead of numbers.
    //
    //  Query Format #2:
    //
    //      form  = name of local definition file (without the .txt extension)
    //
    //      The definition file has a list of dimension elements on each line. These
    //      correspond to variable values "@1", "@2", etc. contained in the "dims" 
    //      query parameter.
    //
    //      Each line in the file can also contain an options object: Start the line with
    //      "={...}" as the first parameter. Values of the object within {...} are:
    //      desc - a description that is returned to the caller as the first value for each sub-array.
    //      mult - a multiplier applied to numeric values
    //      dec  - number of digits to right of decimal
    //      form - format specifier, contains one or more of these characters:
    //         "$" to format as currency
    //         "%" to format as percentage
    //         "," to use 1000's separators
    //         "(" to format negative numbers in parenthesis
    //      Note: If "dec" or "form" are specified, converted string values are returned instead
    //      of numbers.
    //
    Get_Table: function (req, res) {
        if (!req.query.db) { res.status(400).send('Missing db parameter'); return; }
        if (!req.query.cube) { res.status(400).send('Missing cube parameter'); return; }
        if (!req.query.dims) { res.status(400).send('Missing dims parameter'); return; }
        
        var form = req.query.form;
        var expand = req.query.expand;
        if (!form && !expand) { res.status(400).send('Missing form or expand parameter'); return; }
        
        var app = req.app;
        if (app.locals.shutdown === "Y") { res.status(500).send('Server is shut down'); return; }
        var server = app.locals.palo_server;
        var userid = app.locals.palo_userid;
        var passwd = app.locals.palo_passwd;

        var cube = PALOAPI.prototype.removeQuotes(req.query.cube);
        var db = PALOAPI.prototype.removeQuotes(req.query.db);
        if (Array.isArray(app.locals.palo_allowdatabases) && app.locals.palo_allowdatabases.indexOf(db) < 0) {
            res.status(400).send('The requested database is not permitted for this application.'); return;
        }

        var table = [];
        var options = [];
        var dimindex;
        var odims = req.query.dims.match(/("[^"]*")|[^;]+/g);     
        var maxlevel = req.query.level;
        var indent = req.query.indent;
        var fixeddecimals;
        var numberform;
        var nonempty;

        if (form) {
            //
            //  Read the definition file
            //       
            var filename = "./data/" + form + ".txt";
            fs.readFile(filename, { encoding: 'utf-8' }, function (err, data) {
                if (err) {
                    if (app.get('env') === 'development') {
                        //  Only send full error in development mode
                        res.send(err);
                    }
                    else {
                        res.status(400).send("Definition file does not exist or is not valid");
                    }
                    return;
                }
                
                var lines = data.split('\n');
                for (var i = 0; i < lines.length; i++) {
                    var l = lines[i].trim();
                    if (l.length == 0 || l[0] == ';') continue;
                    var hasopts = false, opts;
                    if (l[0] == "=") {
                        hasopts = true;
                        l = l.substr(1);
                    }
                    
                    var vars = l.match(/("[^"]*")|[^;]+/g);
                    dims = odims.slice(0);
                    if (hasopts) {
                        opts = JSON.parse(vars[0]);
                        vars = vars.slice(1);
                    }
                    else
                        opts = {};
                    
                    for (var j = 0; j < dims.length; j++) {
                        if (dims[j][0] == "@") {
                            var sub = parseInt(dims[j].substr(1));
                            if (!isNaN(sub) && sub <= vars.length) dims[j] = vars[sub - 1];
                        }
                    }
                    
                    table.push(dims);
                    options.push(opts);
                }
                
                if (table.length == 0) {
                    res.status(500).send("Definition file is not valid");
                    return;
                }
                
                getServerData();
            });
        }
        else {
            expand = PALOAPI.prototype.removeQuotes(expand);
            maxlevel = (isNaN(maxlevel) || maxlevel < 0) ? 1 : Number(maxlevel);
            ident = (isNaN(indent) || indent < 0) ? 1 : Number(indent);
            nonempty = req.query.nonempty;
            var numform = PALOAPI.prototype.removeQuotes(req.query.numberformat);
            if (numform) {
                fixeddecimals = Number(numform[0]);
                numberform = numform.substr(1);
            }

            for (var i=0; i < odims.length; i++)
                odims[i] = PALOAPI.prototype.removeQuotes(odims[i]);

            //
            //  Read dimension elements ...
            //	First lookup dimension in our cache ...
            //
            var diminfo = PALOAPI.prototype.getDIMINFO(server, null, db, expand);
            if (diminfo && diminfo.elements) {
                prepareelements(diminfo);
                return;
            }
            
            //
            //	Need to login to server to retrieve element information ...
            //
            PALOAPI.preparesession(server, null, userid, passwd, function (api, success) {
                if (success) {
                    api.getelements(server, null, db, expand, null, res, prepareelements);
                }
                else
                    res.status(500).send('Server login failed ->' + api.lasterror);
            });

            //
            //	Function to handle setup of dimension elements
            //
            function prepareelements(diminfo) {
                var cubeinfo = PALOAPI.prototype.getCUBEINFO(server, null, db, cube);
                if (!cubeinfo) {
                    res.status(400).send("Cube'" + cube + "' does not exist.");
                    return;
                }
                dimindex = cubeinfo.dimensions.indexOf(diminfo.dimId);
                if (dimindex < 0) {
                    res.status(400).send("Dimension '" + diminfo.dimName + "' is not in the cube '" + cube + "'.");
                    return;
                }
                
                //  Parent element:
                var parent = odims[dimindex];
                table.push(parent);
                opts = { "desc": parent };
                if (!isNaN(fixeddecimals)) opts.dec = fixeddecimals;
                if (numberform) opts.form = numberform;
                options.push(opts);
                
                var root = diminfo.elements[parent];
                if (!root) {
                    res.status(400).send('Parent element does not exist'); return;
                }
                if (root.childids != "") {
                    var childids = root.childids.split(",");
                    for (var i = 0; i < childids.length; i++) {
                        var child = diminfo.elemsById[childids[i]];                        
                        addChild(diminfo, child, 1);
                    }
                }

            getServerData();
            }
            
            //  Add child elements to retrieve table:
            function addChild(diminfo, elem, elevel) {
                if (!elem) return;             
                for (var ind = ''; ind.length < indent*elevel; ind += ' ') { }
                var elname = ind + elem.name;
                table.push(elem.name);
                opts = { "desc": elname };
                if (!isNaN(fixeddecimals)) opts.dec = fixeddecimals;
                if (numberform) opts.form = numberform;
                opts.nonempty = nonempty;
                options.push(opts);
                
                if (elem.childids != "" && (maxlevel == 0 || elevel < maxlevel)) {
                    var childids = elem.childids.split(",");
                    for (var i = 0; i < childids.length; i++) {
                        var child = diminfo.elemsById[childids[i]];
                        addChild(diminfo, child, elevel + 1);
                    }                                    
                }
            }

        }
        
        //
        //  Read all data from the server and accumulate here ...
        //
        function getServerData() {            
            //
            //  Response-wrapper object used to accumulate rows of data
            //  (the send method replaces res.send within getdata)
            //
            var accum = {
                api : null,
                nextrow : 0,
                more : true,
                result : [],
                send : function (results) {
                    if (Array.isArray(results)) {
                        if (this.nextrow == 0 && req.query.headers && options[0].headers) {
                            //  return headers as first row  
                            if (options[0].desc) options[0].headers.unshift(this.api.removeQuotes(req.query.headers));
                            this.result.push(options[0].headers);
                        }
                        var retres = !options[this.nextrow].allempty;
                        if (options[this.nextrow].headers) options[this.nextrow].headers = null;
                        this.more = ++this.nextrow < table.length;
                        if (retres) this.result.push(results);
                        //if (opts && opts.nonempty) opts.allempty = true;
                    }
                    else {
                        this.result = results;
                        this.more = false;
                    }
                    if (this.more) {
                        var dims;
                        if (form)
                            dims = table[this.nextrow];
                        else {
                            dims = odims;
                            odims[dimindex] = table[this.nextrow];
                        }
                        this.api.getdata(db, cube, dims, this, this.nextrow < table.length - 1, options[this.nextrow]);
                    }
                    else {
                        res.send(this.result);
                        this.api = null;
                    }
                },
                status : function (value) {
                    res.status(value);
                    return this;
                }
            };
                
            function dogetdata(api) {
                accum.api = api;
                accum.more = accum.nextrow < table.length - 1;
                var dims;
                if (form)
                    dims = table[accum.nextrow];
                else {
                    dims = odims;
                    odims[dimindex] = table[accum.nextrow];
                }
                api.getdata(db, cube, dims, accum, accum.more, options[accum.nextrow]);
            }
                
            PALOAPI.preparesession(server, null, userid, passwd, function (api, success) {
                if (success)
                    dogetdata(api);
                else
                    res.status(500).send('Server login failed ->' + api.lasterror);
            });
            
        };
    },

    
    /*---------------------------------------------------------------*/
    /* GET /elements = Get PALO elements from one or more dimensions */
    /*---------------------------------------------------------------*/
    //
    //  Query parameters for GET request are:
    //  db     = Database name
    //  dim    = dimension name(s)
    //  parent = parent element(s), or empty for root
    //  type   = Base, Cons, or All (default) - only 1st letter checked
    //  format = Hierarchy or Flat (default) - only 1st letter checked
    //  levels = # of levels to return (1 is 1st children of parent), 0 for all (default)
    //
    //  Values are returned in a JSON array. Each element is either:
    //  1. A base element name, or all elements in a flat view
    //  2. An array with a consolidated element in index 0 and a list
    //     of children in subsequent positions. Note that if there are
    //     multiple levels present, the children could be arrays with 
    //     their own children.   
    //
    //  Multiple requests can be batched. In this case, each of the query parameters
    //  after the database name should be lists of values enclosed in square brackets. 
    //  In this case, the return value is an array of value arrays as described above.
    //  For example:    
    //      &dim=[Company,Year]&format=[H,F]&type=[A,B]
    //  
    Get_Elements: function (req, res) {
        
        //  Helper function to initialize an array:
        function fillArray(len, val) {
            var retval = new Array(len);
            for (var i=0; i < len; i++)
                retval[i] = val;
            return retval;
        }
        
        //
        //  Parse the query parameters
        //
        var db = PALOAPI.prototype.removeQuotes(req.query.db);
        if (!db) { res.status(400).send('Missing or invalid db parameter'); return; }
        var dim = PALOAPI.prototype.parseValueList(req.query.dim);
        if (!dim) { res.status(400).send('Missing or invalid dim parameter'); return; }

        var app = req.app;
        if (app.locals.shutdown === "Y") { res.status(500).send('Server is shut down'); return; }
        var server = app.locals.palo_server;
        var userid = app.locals.palo_userid;
        var passwd = app.locals.palo_passwd;

        if (Array.isArray(app.locals.palo_allowdatabases) && app.locals.palo_allowdatabases.indexOf(db) < 0) {
            res.status(400).send('The requested database is not permitted for this application.'); return;
        }

        var format = PALOAPI.prototype.parseValueList(req.query.format);
        if (format) {
            if (format.length != dim.length) {
                res.status(400).send('Invalid format parameter.'); return; 
            }
            for (var i=0; i < format.length; i++) {
                format[i] = format[i][0].toUpperCase();
                if (format[i] != "F" && format[i] != "H") { res.status(400).send('Invalid format parameter.'); return; }
            }
        }
        else
            format = fillArray(dim.length, "F");
        var eltype = PALOAPI.prototype.parseValueList(req.query.type);
        if (eltype) {
            if (eltype.length != dim.length) {
                res.status(400).send('Invalid type parameter.'); return;
            }
            for (var i = 0; i < eltype.length; i++) {
                eltype[i] = eltype[i][0].toUpperCase();
                if (eltype[i] != "A" && eltype[i] != "B" && eltype[i] != "C") { res.status(400).send('Invalid type parameter'); return; }
            }
        }
        else
            eltype = fillArray(dim.length, "A");
        var maxlevel = PALOAPI.prototype.parseValueList(req.query.level);
        if (maxlevel) {
            if (maxlevel.length != dim.length) {
                res.status(400).send('Invalid level parameter.'); return;
            }
            for (var i = 0; i < maxlevel.length; i++) {
                maxlevel[i] = Number(maxlevel[i]);
                if (isNaN(maxlevel[i]) || maxlevel[i] < 0) { res.status(400).send('Invalid level parameter'); return; }
            }
        }
        else
            maxlevel = fillArray(dim.length, 0);
        var parent = PALOAPI.prototype.parseValueList(req.query.parent);
        if (parent && parent.length != dim.length) {
            res.status(400).send('Invalid parent parameter.'); return;
        }
        
        //
        //  First lookup dimensions in our cache ...
        //
        var diminfo = new Array(dim.length);
        var found = 0, next = -1;
        for (var i = 0; i < diminfo.length; i++) {
            diminfo[i] = PALOAPI.prototype.getDIMINFO(server, null, db, dim[i]);
            if (diminfo[i] && diminfo[i].elements)
                found++;
            else if (next < 0)
                next = i;
        }
        if (found == diminfo.length) {
            // All dimensions found in cache ...
            returnelements(diminfo);
            return;
        }

        //
        //  Need to login to server to retrieve element information ...
        //
        PALOAPI.preparesession(server, null, userid, passwd, function (api, success) {
            if (success) {
                getdimelements(null, api);
            }
            else
                res.status(500).send('Server login failed ->' + api.lasterror);
        });
        
        //  Function to retrieve and add each dimension to the return array:
        function getdimelements(diminf, api) {
            if (diminf) {
                diminfo[next] = diminf;
                next++;
                found++;
            }
            for (var i = next; i < diminfo.length; i++) {
                if (!diminfo[i] || !diminfo[i].elements) {
                    next = i;
                    api.getelements(server, null, db, dim[i], null, res, getdimelements, found<diminfo.length-1);
                    return;
                }
            }            
        returnelements(diminfo);
        }

        //
        //  Function to handle return of requested elements
        //
        function returnelements(diminfo) {
            
            function addChild(diminfo, retset, elem, elevel, maxlevel) {
                if (!elem)
                    retset.push("undefined");
                else if (elem.childids == "" || (maxlevel > 0 && elevel >= maxlevel))
                    retset.push(elem.name);
                else {
                    var childids = elem.childids.split(",");
                    var elset = [];
                    elset.push(elem.name);
                    for (var i = 0; i < childids.length; i++) {
                        var child = diminfo.elemsById[childids[i]];
                        addChild(diminfo, elset, child, elevel + 1, maxlevel);
                    }
                    retset.push(elset);
                }
            }
            
            var ret = new Array(diminfo.length);
            for (var di = 0; di < diminfo.length; di++) {
                ret[di] = [];                
                if (parent) {
                    var pn = parent[di];
                    var root = diminfo[di].elements[pn];
                    if (!root) {
                        res.status(400).send("Parent element does not exist for dimension '" + diminfo[di].dimName + "'."); return;
                    }
                    // TODO: Need to handle flattened case with root & multiple levels
                    if (root.childids != "") {
                        var childids = root.childids.split(",");
                        for (var i = 0; i < childids.length; i++) {
                            var child = diminfo[di].elemsById[childids[i]];
                            if (format[di] == "F")
                                ret[di].push(child.name);
                            else
                                addChild(diminfo[di], ret[di], child, 1, maxlevel[di]);
                        }
                    }
                }        
                else {
                    for (var elname in diminfo[di].elements) {
                        var elem = diminfo[di].elements[elname];
                        if ((eltype[di] == "B" && elem.childids != "") || (eltype[di] == "C" && elem.childids == ""))
                            continue;
                        if (format[di] == "F")
                            ret[di].push(elname);
                        else if (elem.depth == 0) {
                            addChild(diminfo[di], ret[di], elem, 1, maxlevel[di]);
                        }
                    }
                }
            }
            
            //  Return the result:
            res.send(ret.length > 1 ? ret : ret[0]);
        }
    
    },
        
    /* ------------------------------------- */
    /* PUT /data - Set PALO data cell values */
    /* ------------------------------------- */
    //
    //  Query parameters for PUT request are:
    //  db   = Database name
    //  cube = Cube name
    //  dims = list of dimension values, semicolon separated and quoted as needed
    //
    //  Multiple values can be updated by specifying a range in the same form as the GET request.
    //
    //  The data supplied is either a single value or an array of values. The JSON "[" and "]"
    //  are optional. If omitted, CSV parsing is used.
    //
    //  Note: Maximum update is 1000 elements, maximum body size is 1,000,000 characters.
    //  
    Put_Data: function (req, res) {

        var app = req.app;
        if (!app.locals.palo_allowsetdata) {
            res.status(400).send('Data updates are disabled for this application.');
            return;
        }
        
        // To parse body as plain text ...
        var body = "";
        var dataerr = false;
        req.setEncoding("utf8");
        req.on("data", function (chunk) {
            if (body.length + chunk.length > 1000000) {
                dataerr = true;
                res.status(400).send('Body is too large.');
            }
            else
                body += chunk;
        });
        req.on("end", function () {
            if (dataerr) return;
            try {
                req.body = body;
                onrequest();
            } catch (err) {
                res.status(500).send(err);
            }
        });
        
        //  Handle request once completely received:  
        function onrequest() {
            if (!req.query.db) { res.status(400).send('Missing db parameter'); return; }
            if (!req.query.cube) { res.status(400).send('Missing cube parameter'); return; }
            if (!req.query.dims) { res.status(400).send('Missing dims parameter'); return; }

            var db = PALOAPI.prototype.removeQuotes(req.query.db);
            if (Array.isArray(app.locals.palo_allowdatabases) && app.locals.palo_allowdatabases.indexOf(db) < 0) {
                res.status(400).send('The requested database is not permitted for this application.'); return;
            }

            if (app.locals.shutdown === "Y") { res.status(500).send('Server is shut down'); return; }
            var server = app.locals.palo_server;
            var userid = app.locals.palo_userid;
            var passwd = app.locals.palo_passwd;
            var PALOAPI = require('../process/apaloapi');
            
            var values = (body[0] == "[") ? JSON.parse(body) : PALOAPI.prototype.splitCSVRange(body, ',', '"', null);
            
            PALOAPI.preparesession(server, null, userid, passwd, function (api, success) {
                if (success) {
                    var cube = api.removeQuotes(req.query.cube);
                    var dims = req.query.dims.match(/("[^"]*")|[^;]+/g);
                    api.getsetdata(db, cube, dims, res, values);
                }
                else {
                    res.status(500).send('Server login failed ->' + api.lasterror);
                }
            });

        }
    }

};


module.exports = reqs;