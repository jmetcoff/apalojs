/* APALOJS Sample based on Jedox BikersBest Management Report */
/* (c) 2016 Junction BI LLC */
; MGMTREPORT = {
    monthNames: ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"],

    //  Table identation:
    identPerLevel: 20,
    
    /* Initial setup: Set date to today */
    setdefaults: function () {
        var today = new Date();
        var month = this.monthNames[today.getMonth()];
        $("#year").val(today.getFullYear());
        $("#month").val(month);
        this.selectdate();             
    },
    
    /* Select date */
    selectdate: function () {
        var mname = $("#month").val();
        var mn = this.monthNames.indexOf(mname);
        var yr = $("#year").val().substring(2);
        $("#saymonth").text(mname);       
        this.retrievesummary();
    },
    
    /* Retrieve data */
    retrievesummary: function () {
        var mname = $("#month").val();
        var mn = this.monthNames.indexOf(mname);
        var mns = mname.substring(0,3);
        var mnytd = mn == 0 ? mns : mns + " YTD";
        var yr = $("#year").val();
        var lv = $("#depth").val();

        //  Prepare retrieve request: : Mon|Mon YTD, Budget|Actual, Units|Sales
        var url1 = 'http://' + location.host + '/apalo/table?expand=Products&level=' + lv + '&indent=1&db="Biker"&cube="Orders2"&numberformat="0,"&dims="' + yr + '";="' + mns + '","' + mnytd + '";"All Products";"All Customers";"All Channels";="Actual","Budget";="Units","Sales"'
        
        //  Retrieve values
        MGMTREPORT.waitCursor();
        $.getJSON(url1).then(function (data) {
            MGMTREPORT.requestComplete();
            var tbl = $('#bikersumtbl tbody');
            tbl.empty();
            MGMTREPORT.makeTable(tbl, data);
        }).fail(function (err) {
            MGMTREPORT.requestComplete();
            MGMTREPORT.retrievefailed(err, err.statusText, err.status);            
        });
    },
    
    retrievefailed: function (jqXHR, status, error){
        var errortext = jqXHR.responseText || error || status;
        alert("server request failed: " + errortext);
    },

    waitCursor: function () {
        $('*').css('cursor', 'progress');
    },
    
    //  For server calls:        
    requestComplete: function () {
        $('*').css('cursor', 'default');
    },   

    /* Format table: units|sales, element-name, actual, budget, ytd-actual, ytd-budget */
    makeTable: function (container, repdata) {
        var sayUnits = "Units", saySales = "Sales";
        for (var pass = 0; pass <= 1; pass++) {
            $.each(repdata, function (rowIndex, line) {
                /*
                Note: Each response element comes from the cartesian product:
                    Mon|Mon YTD x Actual|Budget x Units|Sales
                So:
                    [0] = Product Name
                    [1] = Mon, Actual, Units
                    [2] = Mon, Actual Sales
                    [3] = Mon, Budget, Units
                    [4] = Mon, Budget, Sales
                    [5+] = Mon YTD ...
                */
                var row = $("<tr/>");
                var valclass = 'sumtbl-right';
                if (pass > 0) valclass += " enMoney";
                row.append($("<td/>", { class: 'sumtbl-leftbold' }).text(pass == 0 ? sayUnits : saySales));
                var prodclass = 'sumtbl-leftbold';
                if (line[0][0] == " ") prodclass = 'sumtbl-normal';
                var indent = 0;
                for (var i = 1; i < line[0].length; i++)
                    { if (line[0][i] == ' ') indent += MGMTREPORT.identPerLevel; else break;}                
                row.append($("<td/>", {class: prodclass, style: 'padding-left: ' + indent  }).text(line[0]));
                row.append($("<td/>", { class: valclass }).text(line[1+pass]));
                row.append($("<td/>", { class: valclass }).text(line[3+pass]));
                row.append($("<td/>"));
                row.append($("<td/>", { class: valclass }).text(line[5+pass]));
                row.append($("<td/>", { class: valclass }).text(line[7+pass]));
                if (pass == 0) sayUnits = ""; else saySales = "";
                container.append(row);
            });
        if (pass == 0) container.append($('<tr style="border-bottom:1px solid black"><td colspan="100%"></td></tr>'));
        }        
    },

};

/* Initialize on page load */
$(function () { MGMTREPORT.setdefaults(); })
