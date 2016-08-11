//  APALOJS Route handlers
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

var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res) {    
    res.render('index', { title: req.app.locals.app_title });
});

router.get('/jbx1', function (req, res) {
    res.render('jbx1', { title: req.app.locals.app_title });
});

router.get('/dpr', function (req, res) {
    res.render('dpr1', { title: req.app.locals.app_title });
});

router.get('/update', function (req, res) {
    res.render('update', { title: 'ApaloJS Update Test' });
});

module.exports = router;