// Copyright (c) 2021 Andrei O.
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Imports
import EosApi from 'eosjs-api';
import fs from 'fs';
import serializeJs from 'serialize-javascript';
import perf_hooks from 'perf_hooks';
const performance = perf_hooks.performance;

// Config to control the script
const scriptOptions = {
  getBlacklist: false, // Should we redownload the list
  loggerVerbose: false,
  whiteList: [
    // BlackListed accounts that are allowed to create new accounts(skip those)
    'yupyupyupyup',
  ],
  // How many last transaction per account to scan:
  // increasing this will increse the executing time exponentially
  noLastTransactionToScan: 50,
  // How many blacklist accounts should be fetched from table ( only works on redownloading the blacklist)
  blacklistLimit: 4000,
  // Contiune From account ( 0 is from begining )
  contineFromAccount: 3399,
  // Console output at every scanned account
  enableAccountConsoleOutput: true,
  // End stats Output
  enableEndOutput: true,
  // Disable write to suspects.txt
  disableWriteSuspects: true,
};

// Utils - Start
const deSerializeJs = (string) => eval('(' + string + ')');

const getTimeString = (ms, sep = '-') => {
  const sign = ~~ms < 0 ? '-' : '';
  const absMs = Math.abs(~~ms);
  const [h, m, s] = [1000 * 60 * 60, 1000 * 60, 1000].map((calcMs) => ('0' + ~~((absMs / calcMs) % 60)).substr(-2));
  return `${sign} hours: ${parseInt(h, 10) ? `${h} ${sep} minutes: ` : ''}${m} ${sep} seconds: ${s}`;
};
// Utils - End

// Main
const rcpOptions = {
  httpEndpoint: 'https://eos.greymass.com:443', // default, null for cold-storage
  verbose: false, // API logging
  logger: {
    // Default logging functions
    log: scriptOptions.loggerVerbose ? console.log : null,
    error: scriptOptions.loggerVerbose ? console.error : null,
  },
  fetchConfiguration: {},
};

const eosApi = EosApi(rcpOptions);

let blacklistedAccounts;

if (scriptOptions.getBlacklist) {
  blacklistedAccounts = await eosApi.getTableRows(true, 'yupyupyupyup', 'yupyupyupyup', 'blacklist', 'owner', 0, -1, scriptOptions.blacklistLimit);
  fs.writeFileSync('blacklist.txt', serializeJs(blacklistedAccounts));
} else {
  blacklistedAccounts = deSerializeJs(fs.readFileSync('blacklist.txt'));
}

// Don't check whitelisted accounts ( blacklisted accounts that are allowed to make new accounts ) and skip the first two which are invalid: "" , ".ajri...5.5"
let [, , ...filtredBlList] = blacklistedAccounts.rows
  .filter((blacklistedAccount) => !scriptOptions.whiteList.find((wAccount) => wAccount === blacklistedAccount.owner))
  .map((e) => e.owner);

if (scriptOptions.contineFromAccount > 0) {
  filtredBlList = filtredBlList.slice(scriptOptions.contineFromAccount, scriptOptions.blacklistLimit);
}

const timeStart = performance.now();
const susAccounts = [];
let [accountsScanned, transactionsScanned] = scriptOptions.contineFromAccount > 0 ? [scriptOptions.contineFromAccount, 0] : [0, 0];
for (const blackListedAccount of filtredBlList) {
  let accountInfo;
  try {
    accountInfo = await eosApi.getAccount(blackListedAccount);
  } catch (e) {
    console.log('Owner name invalid');
    continue;
  }
  accountsScanned++;
  const last_action = (await eosApi.getActions(blackListedAccount, -1, -1)).actions[0].account_action_seq;
  // Scan last [noLastTransactionToScan] Transactions
  const actions = (
    await eosApi.getActions(blackListedAccount, last_action - scriptOptions.noLastTransactionToScan, scriptOptions.noLastTransactionToScan)
  ).actions;

  for (const transaction of actions) {
    transactionsScanned++;
    // It is a token transfer?
    if (transaction.action_trace.act.name === 'transfer') {
      // It is a YUP transfer?
      if (transaction.action_trace.act.account === 'token.yup' && transaction.action_trace.act.data.from === blackListedAccount) {
        const senderAccountInfo = await eosApi.getAccount(transaction.action_trace.act.data.to);
        // Is receiver a YUP Account?
        let isYUPAccount = false;
        for (const perm of senderAccountInfo.permissions) {
          if (perm.perm_name === 'createvotev2') {
            isYUPAccount = true;
            break;
          }
        }
        // Is new Account?
        if (isYUPAccount) {
          if (new Date(senderAccountInfo.created) > new Date(accountInfo.created)) {
            // check is suspected account is not on the blacklist
            if (!filtredBlList.find((blAccc) => blAccc === senderAccountInfo.account_name)) {
              susAccounts.push(senderAccountInfo.account_name);
            }
            break;
          }
        }
      }
    }
  }
  if (scriptOptions.enableAccountConsoleOutput)
    console.log(`Accounts Scanned: ${accountsScanned} , Transactions Scanned: ${transactionsScanned}, Sus ACC: [ ${susAccounts} ]`);
}

const timeEnd = performance.now();

const endMsg = {
  date: `\nScan Date: ${new Date().toString()}\n`,
  stat: `Accounts Scanned: ${accountsScanned} , Transactions Scanned: ${transactionsScanned}\n`,
  duration: `Scan total duration: ${getTimeString(timeEnd - timeStart)}\n`,
};

if (!scriptOptions.disableWriteSuspects) {
  // Write Suspect file list
  const file = fs.createWriteStream('suspects.txt', {
    autoClose: false,
    flags: 'w',
  });
  susAccounts.forEach((v) => {
    file.write(`${v}\n`);
  });
  file.write(endMsg.date);
  file.write(endMsg.stat);
  file.write(endMsg.duration);
  file.close();
}
if (scriptOptions.enableEndOutput) {
  console.log(endMsg.date);
  console.log(endMsg.stat);
  console.log(endMsg.duration);
}

console.log('DONE !');
