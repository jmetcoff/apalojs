/*----------------------------------------------------*/
/*  APALOJS router : Provides access to PALO Servers  */
/*----------------------------------------------------*/
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
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.See the
//  GNU General Public License for more details.
//
//  You should have received a copy of the GNU General Public License
//  along with this program.If not, see < http://www.gnu.org/licenses/>.
//
//  --------------------------------------------------------------------------
//
//  This router acts as a proxy for access to PALO servers using proper
//  cube, dimension and element names passed in request parameters.
//  Supported urls are:
//      apalo/data     - GET one or a range of cell values from a cube
//                       PUT one or a range of cell values to a cube
//      apalo/elements - GET element names in a dimension
//      apalo/table    - GET a table of values using either dimension expansion or a preconfigured definition file.
//      apalo/clear-cache - reset cached definitions (admin. or developer only)
//
//  Work to be completed (also see APALOAPI.js comments):
//  * Security on updates, reset & diagnostics function
//  * OLAP Login security (by group?)
//  * GET /elements - flat format w/ parent, sort order
//  * Cache-control headers?
//
var express = require('express');
//var bodyparser = require('body-parser');
var router = express.Router();
var PALOAPI = require('../process/apaloapi');
var PALOREQS = require('../process/apaloreqs');;
module.exports = router;

var conf = require('../config.json');
if (conf.max_sessions_per_server)
    PALOAPI.prototype.MaxSessionsPerServer = conf.max_sessions_per_server;
if (conf.save_sessions_per_server)
    PALOAPI.prototype.SaveSessionsPerServer = conf.save_sessions_per_server;


/* ------------ */
/* / = GET root */
/* ------------ */

router.get('/', function (req, res) {
    res.status(400).send('No function specified.');
});


/* ----------- */
/* Main routes */
/* ----------- */

/* GET /data = access palo data cell or range of cells */
router.get('/data', PALOREQS.Get_Data);

/* GET /table - retrieve predefined cell ranges using a local definition file */
router.get('/table', PALOREQS.Get_Table);   

/* GET /elements = Get PALO dimension elements */
router.get('/elements', PALOREQS.Get_Elements);

/* PUT /data - Set PALO data cell values */
router.put('/data', PALOREQS.Put_Data);    


/* ---------------------------------------------- */
/* /clear-cache - Reset/reload server definitions */
/* ---------------------------------------------- */
//
//  This function is used by administrators or developers when changes are made to 
//  the data model on the server. Either a single database or all databases can be
//  reloaded.
//
//  Note: In general, the token-caching mechanism is sufficient. 
//
//  TODO: Add security.
//
router.get('/clear-cache', function (req, res) {
    if (!req.query.db) { res.status(400).send('Missing db parameter'); return; }
    var app = req.app;
    if (app.locals.shutdown === "Y") { res.status(500).send('Server is shut down'); return; }
    //if (!app.locals.palo_allowsetdata) {res.status(400).send('Data updates are disabled for this application.'); return;}
    var server = app.locals.palo_server;
    var db = PALOAPI.prototype.removeQuotes(req.query.db);
    PALOAPI.reset(server, db);
    res.send("OK");
});


/* ----------- */
/* Diagnostics */
/* ----------- */

router.get('/diag', function (req, res) {
    if (!req.query.func) { res.status(400).send('Missing func parameter'); return; }

    var app = req.app;
    var server = app.locals.palo_server;
    var userid = app.locals.palo_userid;
    var passwd = app.locals.palo_passwd;

    switch (req.query.func) {
        case "stats":
            var lines = [];
            for (var serverKey in PALOAPI.prototype.servers) {
                var serverInfo = PALOAPI.prototype.servers[serverKey];
                lines.push({
                    Server: serverKey, TotalRequests: serverInfo.totalrequests, ActiveSessions: serverInfo.activesessions, 
                    PendingRequests: serverInfo.pendingrequests.length, MaxPendingRequests: serverInfo.maxpendingrequests, 
                    TotalQueuedRequests: serverInfo.totalqueuedrequests
                });
            }
            res.send(JSON.stringify(lines,null,1));
            break;

        /*
        case "testwait": {
            if (app.locals.shutdown === "Y") { res.status(500).send('Server is shut down'); return; }
            var seconds = Number(req.query.time);
            if (isNaN(seconds) || seconds < 0 || seconds > 999) { res.status(400).send('Missing or invalid time parameter'); return; }
            PALOAPI.preparesession(server, null, userid, passwd, function (api, success) {
                if (success)
                    api.testwait(res, seconds);
                else
                    res.status(500).send('Server login failed ->' + api.lasterror);
            });
            break;
        }
        */

        default:
            res.status(400).send('Bad function');
            break;
    }

});

/* ----------------- */
/* Shutdown handling */
/* ----------------- */

router.cleanshutdown = function () {
    var PALOAPI = require('../process/apaloapi');
    var didlogout = PALOAPI.shutdown();
    return didlogout ? 5000 : 0;
};
