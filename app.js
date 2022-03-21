require('dotenv').config();
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const saltRounds = 10;
const ejs = require('ejs');
const moment = require('moment');
app.locals.moment = require('moment');
const test = require('./test');

const jwtDecode = require('jwt-decode');
const {
    TokenSet
} = require('openid-client');
const PDFDocument = require('pdfkit');
const fs = require('fs');


const {
    Account,
    Accounts,
    AccountType,
    Allocation,
    Allocations,
    BankTransaction,
    BankTransactions,
    BankTransfer,
    BankTransfers,
    BatchPayment,
    BatchPayments,
    Contact,
    ContactGroup,
    ContactGroups,
    ContactPerson,
    Contacts,
    Currency,
    CurrencyCode,
    Employees,
    HistoryRecords,
    Invoice,
    Invoices,
    Item,
    Items,
    LineAmountTypes,
    LineItem,
    LinkedTransaction,
    LinkedTransactions,
    ManualJournal,
    ManualJournals,
    Payment,
    Payments,
    PaymentServices,
    Prepayment,
    PurchaseOrder,
    PurchaseOrders,
    Quote,
    Quotes,
    Receipt,
    Receipts,
    TaxRate,
    TaxRates,
    TaxType,
    TrackingCategories,
    TrackingCategory,
    TrackingOption,
    XeroAccessToken,
    XeroClient,
    XeroIdToken,
    CreditNotes,
    CreditNote,
    Employee
} = require('xero-node');
const res = require('express/lib/response');


const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirectUrl = process.env.REDIRECT_URL;
const scopes = process.env.SCOPES;


app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(express.static('public'))
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');


const xero = new XeroClient({
    clientId: client_id,
    clientSecret: client_secret,
    redirectUris: [redirectUrl],
    openIdClient: TokenSet,
    scopes: scopes.split(" "),
});


if (!client_id || !client_secret || !redirectUrl) {
    throw Error('Environment Variables not all set - please check your .env file in the project root or create one!')
}


app.use(session({
    secret: 'something crazy',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false
    },
}));

///////////////   MONGOOSE CONNECTION   ///////////////
let dbUser = process.env.DB_USER;
let dbPassword = process.env.DB_PASSWORD;
mongoose.connect(`mongodb+srv://${dbUser}:${dbPassword}@cluster0.r4lsb.mongodb.net/Centeralised-Accounting-DB?retryWrites=true&w=majority`, {
    useNewUrlParser: true
});

///////////////  MONGO SCHEMAS  ///////////////
const GroupSchema = new mongoose.Schema({
    title: String,
    description: String,
    tenants: [String],
    report:  [[]],
    created_at: {
        type: Date,
        default: Date.now
    }
});



const Group = mongoose.model('Group', GroupSchema);

let data = [];

const authenticationData = (req, res, next) => {
    return {
        decodedIdToken: req.session.decodedIdToken,
        decodedAccessToken: req.session.decodedAccessToken,
        tokenSet: req.session.tokenSet,
        allTenants: req.session.allTenants,
        activeTenant: req.session.activeTenant,
    }
}

/////////////  GET ROUTES  ///////////////

app.get('/connect', async (req, res) => {
    try {
        const consentUrl = await xero.buildConsentUrl();
        res.redirect(consentUrl);
    } catch (err) {
        res.redirect('/');
    }
})


app.get('/callback', async (req, res) => {
    try {
        const tokenSet = await xero.apiCallback(req.url);
        await xero.updateTenants();
        const decodedIdToken = jwtDecode(tokenSet.id_token);
        const decodedAccessToken = jwtDecode(tokenSet.access_token);
        req.session.decodedIdToken = decodedIdToken;
        req.session.decodedAccessToken = decodedAccessToken;
        req.session.tokenSet = tokenSet;
        req.session.allTenants = xero.tenants;
        req.session.activeTenant = xero.tenants[0];
        const allTenants = xero.tenants;
        res.render('dashboard', {
            authData: authenticationData(req, res),
            pageTitle: 'Dashboard',
            allTenants: allTenants,
        });
    } catch (err) {
        res.redirect('/');
    }
})


app.get('/reconnect', async (req, res) => {
    res.render('reconnect')
});


app.get('/dashboard', async (req, res) => {
    try {
        const tokenSet = await xero.readTokenSet();
        const response = await xero.accountingApi.getOrganisations(req.session.activeTenant.tenantId);
        res.render('dashboard', {
            pageTitle: 'Dashboard',
            authData: authenticationData(req, res),
            organisations: xero.tenants,
        });
    } catch (err) {
        res.redirect('/');
    }
});


app.get('/profit-loss', async (req, res) => {
    const plFromDate = "2022-01-01";
    const plToDate = "2022-12-31";
    const getProfitAndLossResponse = await xero.accountingApi.getReportProfitAndLoss(req.session.activeTenant.tenantId, plFromDate, plToDate);
    const netProfitAndLoss = getProfitAndLossResponse.body.reports[0].rows[5].rows[0].cells[1].value;
    const Organization = getProfitAndLossResponse.body.reports[0].reportTitles[1];
    res.send(`Net Profit and Loss for ${Organization} is ${netProfitAndLoss}`);
});


app.get('/', async (req, res) => {
    try {
        const consentUrl = await xero.buildConsentUrl();
        res.redirect(consentUrl);
    } catch (err) {
        res.redirect('/');
    }
});


app.get('/add-group', (req, res) => {
    // res.send(xero.tenants)
    res.render('add-group', {
        pageTitle: 'Create Group',
        tenants: xero.tenants
    });
});


app.get('/groups', (req, res) => {
    Group.find({}, (err, foundGroups) => {
        if (err) {

        } else {
            res.render('groups', {
                pageTitle: 'Groups',
                groups: foundGroups,
            });
        }
    });
});


app.get('/logout', (req, res) => {
    res.redirect('/');
});


app.get("/date-range-report", async (req, res) => {
    try {
        const startDate = moment().startOf('year').format('YYYY-MM-DD');
        const endDate = moment().endOf('year').format('YYYY-MM-DD');
        let PnL = [];
        for (let i = 0; i < xero.tenants.length; i++) {
            const getProfitAndLossResponse = await xero.accountingApi.getReportProfitAndLoss(xero.tenants[i].tenantId, startDate, endDate);
            const reportBody = getProfitAndLossResponse.body.reports;
            PnL.push(reportBody);
        }
        let report = [];
        for (let i = 0; i < PnL.length; i++) {
            for (let j = 0; j < PnL[i].length; j++) {
                report.push(PnL[i][j]);
            }
        }


        res.render('pnl', {
            pageTitle: 'Year Profit and Loss',
            report: report,
        });
    } catch (err) {

        res.redirect('/');
    }
});


app.get("/monthdate-pnl", async (req, res) => {
    try {
        const startDate = moment().startOf('month').format('YYYY-MM-DD');
        const endDate = moment().endOf('month').format('YYYY-MM-DD');
        let PnL = [];
        for (let i = 0; i < xero.tenants.length; i++) {
            const getProfitAndLossResponse = await xero.accountingApi.getReportProfitAndLoss(xero.tenants[i].tenantId, startDate, endDate);
            const reportBody = getProfitAndLossResponse.body.reports;
            PnL.push(reportBody);
        }
        let report = [];
        for (let i = 0; i < PnL.length; i++) {
            for (let j = 0; j < PnL[i].length; j++) {
                report.push(PnL[i][j]);
            }
        }


        res.render('pnl2', {
            pageTitle: 'Profit and Loss - Month to Date',
            report: report,
        });
    } catch (err) {

        res.redirect('/');
    }
});


app.get("/yeardate-pnl", async (req, res) => {
    try {
        const startDate = moment().startOf('year').format('YYYY-MM-DD');
        const endDate = moment().endOf('year').format('YYYY-MM-DD');
        let PnL = [];
        for (let i = 0; i < xero.tenants.length; i++) {
            const getProfitAndLossResponse = await xero.accountingApi.getReportProfitAndLoss(xero.tenants[i].tenantId, startDate, endDate);
            const reportBody = getProfitAndLossResponse.body.reports;
            PnL.push(reportBody);
        }
        let report = [];
        for (let i = 0; i < PnL.length; i++) {
            for (let j = 0; j < PnL[i].length; j++) {
                report.push(PnL[i][j]);
            }
        }
        res.render('pnl2', {
            pageTitle: 'Profit and Loss - Year to Date',
            report: report,
        });
    } catch (err) {

        res.redirect('/');
    }
});


app.get('/recent-sales', async (req, res) => {
    try {
        let invoices = [];
        for (let i = 0; i < xero.tenants.length; i++) {
            const getInvoicesResponse = await xero.accountingApi.getInvoices(xero.tenants[i].tenantId);
            const invoicesBody = getInvoicesResponse.body.invoices;
            invoices.push(invoicesBody);
        }
        for (let i = 0; i < invoices.length; i++) {
            for (let j = 0; j < invoices[i].length; j++) {
                invoices[i][j].tenantName = xero.tenants[i].tenantName;
            }
        }
        let invoicesArray = [];
        for (let i = 0; i < invoices.length; i++) {
            for (let j = 0; j < invoices[i].length; j++) {
                invoicesArray.push(invoices[i][j]);
            }
        }
        let accountsReceivable = [];
        for (let i = 0; i < invoicesArray.length; i++) {
            if (invoicesArray[i].type === 'ACCREC') {
                accountsReceivable.push(invoicesArray[i]);
            }
        }
        accountsReceivable.sort((a, b) => {
            return new Date(b.date) - new Date(a.date);
        });
        let recentInvoices = [];
        for (let i = 0; i < 20; i++) {
            recentInvoices.push(accountsReceivable[i]);
        }

        res.render('recent-sales', {
            pageTitle: 'Recent Sales',
            invoices: recentInvoices,
        });
    } catch (err) {

        res.redirect('/');
    }
});

app.get('/recent-bills', async (req, res) => {
    try {
        let invoices = [];
        for (let i = 0; i < xero.tenants.length; i++) {
            const getInvoicesResponse = await xero.accountingApi.getInvoices(xero.tenants[i].tenantId);
            const invoicesBody = getInvoicesResponse.body.invoices;
            invoices.push(invoicesBody);
        }
        for (let i = 0; i < invoices.length; i++) {
            for (let j = 0; j < invoices[i].length; j++) {
                invoices[i][j].tenantName = xero.tenants[i].tenantName;
            }
        }
        let invoicesArray = [];
        for (let i = 0; i < invoices.length; i++) {
            for (let j = 0; j < invoices[i].length; j++) {
                invoicesArray.push(invoices[i][j]);
            }
        }
        let accountsPayable = [];
        for (let i = 0; i < invoicesArray.length; i++) {
            if (invoicesArray[i].type === 'ACCPAY') {
                accountsPayable.push(invoicesArray[i]);
            }
        }
        accountsPayable.sort((a, b) => {
            return new Date(b.date) - new Date(a.date);
        });
        let recentBills = [];
        for (let i = 0; i < 20; i++) {
            recentBills.push(accountsPayable[i]);
        }

        res.render('recent-bills', {
            pageTitle: 'Recent Bills',
            invoices: recentBills,
        });

    } catch (err) {

        res.redirect('/');
    }
})

app.get('/compare-6months-pnl', async (req, res) => {
    try {
        const plFromDate = moment().startOf('month').format('YYYY-MM-DD');
        const plToDate = moment().endOf('month').format('YYYY-MM-DD');
        const plPeriods = 6;
        const plTimeframe = "MONTH";
        const plTrackingCategoryID = undefined;
        const plTrackingOptionID = undefined;
        const plTrackingCategoryID2 = undefined;
        const plTrackingOptionID2 = undefined;
        const plStandardLayout = true;
        const plPaymentsOnly = false;

        let PnL = [];
        for (let i = 0; i < xero.tenants.length; i++) {
            const getProfitAndLossResponse = await xero.accountingApi.getReportProfitAndLoss(xero.tenants[i].tenantId, plFromDate, plToDate, plPeriods, plTimeframe, plTrackingCategoryID, plTrackingOptionID, plTrackingCategoryID2, plTrackingOptionID2, plStandardLayout, plPaymentsOnly);
            PnL.push(getProfitAndLossResponse);
        }

        res.render('compare-months-pnl', {
            pageTitle: 'Compare Months Profit and Loss',
            report: PnL,
            moment: moment,
        });
    } catch (err) {

        res.redirect('/');
    }
});

app.get('/balance-sheet', async (req, res) => {
    try {
        const date = moment().format('YYYY-MM-DD');
        let balanceSheet = [];
        for (let i = 0; i < xero.tenants.length; i++) {
            const getBalanceSheetResponse = await xero.accountingApi.getReportBalanceSheet(xero.tenants[i].tenantId, date);
            const reportBody = getBalanceSheetResponse.body.reports;
            balanceSheet.push(reportBody);
        }
        let report = [];
        for (let i = 0; i < balanceSheet.length; i++) {
            for (let j = 0; j < balanceSheet[i].length; j++) {
                report.push(balanceSheet[i][j]);
            }
        }
        res.send(report);
        // res.render('balance-sheet', {
        //     pageTitle: 'Balance Sheet',
        //     report: report,
        // });
    } catch (err) {

        res.redirect('/');
    }
})


app.get('/departments-pnl', async (req, res) => {

})



app.get('/groups-pnl-y2d', async (req, res) => {
    try {
        const plFromDate = moment().startOf('year').format('YYYY-MM-DD');
        const plToDate = moment().endOf('year').format('YYYY-MM-DD');
        const groups = await Group.find({});
        for (let i = 0; i < groups.length; i++) {
            for(let j = 0; j < groups[i].tenants.length; j++){
                const getProfitAndLossResponse = await xero.accountingApi.getReportProfitAndLoss(groups[i].tenants[j], plFromDate, plToDate);
                groups[i].report.push(getProfitAndLossResponse.body.reports);
            }
        }

        res.render('groups-pnl-y2d', {
            pageTitle: 'This Year Profit and Loss (Groups)',
            groups: groups,
            moment: moment,
        });
    } catch (err) {
        console.log(err);
        res.redirect('/');
    }
});

app.get('/groups-pnl-m2d', async (req, res) => {
    try {
        const plFromDate = moment().startOf('month').format('YYYY-MM-DD');
        const plToDate = moment().endOf('month').format('YYYY-MM-DD');
        const groups = await Group.find({});
        for (let i = 0; i < groups.length; i++) {
            for(let j = 0; j < groups[i].tenants.length; j++){
                const getProfitAndLossResponse = await xero.accountingApi.getReportProfitAndLoss(groups[i].tenants[j], plFromDate, plToDate);
                groups[i].report.push(getProfitAndLossResponse.body.reports);
            }
        }

        res.render('groups-pnl-y2d', {
            pageTitle: 'This Month Profit and Loss (Groups)',
            groups: groups,
            moment: moment,
        });
    } catch (err) {
        console.log(err);
        res.redirect('/');
    }
});
      




//////////////    POST ROUTES    //////////////


app.post('/createGroup', (req, res) => {
    const {
        title,
        description,
        tenants
    } = req.body;
    const group = {
        title: title,
        description: description,
        tenants: tenants,
    };
    console.log(group);
    const newGroup = new Group(group);
    newGroup.save();
    res.redirect('/add-group');
});



app.post('/dateRangeSearch', async (req, res) => {
    try {
        const startDate = req.body.startDate;
        const endDate = req.body.endDate;
        let PnL = [];
        for (let i = 0; i < xero.tenants.length; i++) {
            const getProfitAndLossResponse = await xero.accountingApi.getReportProfitAndLoss(xero.tenants[i].tenantId, startDate, endDate);
            const reportBody = getProfitAndLossResponse.body.reports;
            PnL.push(reportBody);
        }
        let report = [];
        for (let i = 0; i < PnL.length; i++) {
            for (let j = 0; j < PnL[i].length; j++) {
                report.push(PnL[i][j]);
            }
        }
        res.render('pnl', {
            pageTitle: 'Year Profit and Loss',
            report: report,
        });
    } catch (err) {

        res.redirect('/');
    }
});





let port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});