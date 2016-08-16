This project is called ApaloJS. It was implemented using Visual Studio 2015 Pro with Node.js Tools. 
Copyright (c) 2016 Junction BI, LLC - Author: J. Metcoff, Contact: jerry.metcoff@junctionbi.com

This project is released under the GNU GPLv3 license. See the LICENSE file for more information.

This is a demonstration of the capabilities that can be achieved by combining modern HTML5/JS applications with a Jedox/Palo back-end.

This service was created for demonstration purposes and is not yet production ready. Some of the additional work items listed below should be completed first.

There is only a single public sample provided at present, it is based on the Bikers demo database. The default index page of the service has a link to that demo page. It is a very simplistic web page with choices for year, month, and depth for expanding. Note that one of the advantages of this service is that the entire table is retrieved in a single request to the service.

See the included .docx file for usage information.

Before using, be sure to install the required node modules listed as dependencies (in VS, choose "Install Missing npm Packages".

Additional work needed/planned
-------------------------------------------
Convert to use Promises for asynchronous request mgmt

Complete exception handling (Promises will  mostly resolve this)

Create Test suite

Improved security model: Security on updates, reset & diagnostics function

Use or allow OLAP login security (maybe by group?)

Need additional testing of PALO token notifications to control caching

Allow for case-insensitive element names

GET /elements - want a flat format w/ parent, sort order

Cache-control headers on responses?

Convert to ES6 Classes or Typescript

Additional demonstration pages (& charts)
