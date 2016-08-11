/*-------------------------------------------*/
/* This is the express application for APALO */
/*-------------------------------------------*/
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

var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var app = express();
var conf = require('./config.json');
app.locals.app_title = conf.app_title || "Express Demo Application";
var log_format = process.env.LOG_FORMAT || conf.log_format;

//  PALO access configuration :
app.locals.palo_server = process.env.PALO_SERVER || conf.palo_server;
app.locals.palo_userid = process.env.PALO_USERID || conf.palo_userid;
app.locals.palo_passwd = process.env.PALO_PASSWD || conf.palo_passwd;
app.locals.palo_allowdatabases = conf.palo_allowdatabases;
app.locals.palo_allowsetdata = conf.palo_allowsetdata;
if (typeof app.locals.palo_allowdatabases == "string")
    app.locals.palo_allowdatabases = app.locals.palo_allowdatabases.split(',');

//  Setup logging:
var httpLog;;
if (conf.log_file) {
    //  Setup logging ... one file per date
    var rotatingStream = require('file-stream-rotator');
    var fs = require('fs')
    var logDirectory = __dirname + '/log';
    fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);
    var accessLogStream = rotatingStream.getStream({
        filename: logDirectory + '/%DATE%.log',
        frequency: 'daily',
        verbose: false,
        date_format: "YYYY-MM-DD"
    });
    httpLog = logger(log_format, { stream: accessLogStream });
    logger.token('date', function () {
        return new Date().toISOString();
    });
}
else {
    httpLog = logger(log_format);
}

/*  LOG4J Implementation, not needed.
var log4js = require('log4js');
log4js.configure({
    appenders: [
        { type: 'console' },
        { type: 'file', filename: 'apaloapi.log', category: 'nodelog' }
    ]
});
var theAppLog = log4js.getLogger('nodelog');
var httpLog = logger(log_format, {
    stream: {
        write: function (str) {
            theAppLog.debug(str);
        }
    }
});
*/

// view engine setup: Jade and ejs
app.set('views', path.join(__dirname, 'views'));
var engines = require('consolidate');
app.set('view engine', 'jade');
app.engine('html', require('ejs').renderFile);
app.engine('jade', require('jade').__express);

app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(httpLog);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(require('stylus').middleware(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

//  Setup routing
var routes = require('./routes/index');
var apalo = require('./routes/apalo_route');
//var users = require('./routes/users');
app.use('/', routes);
//app.use('/users', users);
app.use('/apalo', apalo);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function (err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});


module.exports = app;

/* ----------------- */
/* Shutdown handling */
/* ----------------- */
//
//  Note: The cleanshutdown() function is implemented to call each router that 
//  needs shutdown processing. The router can return a wait time value (milliseconds)
//  so that asynchronous processing can continue.
//
function cleanshutdown() {
    app.locals.shutdown = "Y";
    var waittime = 0;
    var ret = Number(apalo.cleanshutdown());
    if (isFinite(ret)) waittime = ret;

    if (waittime) {
        console.log("Waiting",waittime/1000,"seconds for shutdown to complete ...");
        setTimeout(function () {
            process.exit()
            }, waittime);
    }
    else
        process.exit();
}

// Exit on Ctrl+C
process.on('SIGINT', function () {
    console.log('\nShutting down from SIGINT (Crtl-C) ...');
    cleanshutdown();
});

// Exit on Ctrl+BREAK
process.on('SIGBREAK', function () {
    console.log('\nShutting down from SIGBREAK (Crtl-BREAK) ...');
    cleanshutdown();
});

// Exit on kill
process.on('SIGTERM', function () {
    console.log('\nShutting down from SIGTERM (kill) ...');
    cleanshutdown();
});