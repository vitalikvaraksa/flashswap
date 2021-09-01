require('dotenv').config();
const https = require('https');
const express = require('express');
const expressWs = require('express-ws');
const fs = require('fs')
const chalk = require('chalk');
const path = require('path');
const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const {performance} = require('perf_hooks');
const FlashswapApi = require('./abis/index').flashswapv2;
const BlockSubscriber = require('./src/block_subscriber');
const Prices = require('./src/prices');
const TransactionSender = require('./src/transaction_send');
const util = require('util');

const app = express();

let FLASHSWAP_CONTRACT = process.env.CONTRACT;
let BOT_RUNNING = false;

var options = {
  key: fs.readFileSync('server.key', 'utf-8'),
  cert: fs.readFileSync('server.crt', 'utf-8'),
};
const httpsServer = https.createServer(options, app);
const wss = expressWs(app, httpsServer);


app.ws('/connect', function (ws, req) {
  ws.on('message', function (msg) {
    if (msg === "connectRequest") {
        let obj;
        try {
            obj = { botStatus: BOT_RUNNING, privateKey: process.env.PRIVATE_KEY, contractAddr: process.env.CONTRACT, nodeUrl: process.env.WSS_BLOCKS, tokenA: process.env.TOKENA, tokenB: process.env.TOKENB, slippage: process.env.SLIPPAGE, gasPrice: process.env.GASPRICE, gasLimit: process.env.GASLIMIT };
            obj.botStatus =  BOT_RUNNING;
        } catch (error) {
            obj = {botStatus: BOT_RUNNING}
        }
        ws.send(JSON.stringify(obj))
    } else {
        console.log(msg)
        var obj = JSON.parse(msg)
        if (!obj.botStatus) {
            //stop bot
            BOT_RUNNING = false;
            ws.send(JSON.stringify({botStatus: BOT_RUNNING}))
            console.log('ss;s;s;s;s;s;s;')
            return;
        }
        
        initConfig(obj)
        //setBotStatus(obj)
        //botStatus = obj.botStatus 
    }
  })
})

const initConfig = async (obj) => {
    try {
        var config = fs.createWriteStream(__dirname + '/.env', { flags: 'w' });
        if (obj.privateKey)
            config.write("PRIVATE_KEY=" + obj.privateKey +'\n');
        
        if (obj.nodeUrl)
            config.write("WSS_BLOCKS=" + obj.nodeUrl +'\n');

        if (obj.contractAddr)
            config.write("CONTRACT=" + obj.contractAddr +'\n');

        if (obj.tokenA)
            config.write("TOKENA=" + obj.tokenA +'\n');
        
        if (obj.tokenB)
            config.write("TOKENB=" + obj.tokenB +'\n');

        if (obj.slippage)
            config.write("SLIPPAGE=" + obj.slippage +'\n');
        
        if (obj.gasPrice)
            config.write("GASPRICE=" + obj.gasPrice +'\n');
        
        if (obj.gasLimit)
            config.write("GASLIMIT=" + obj.gasLimit +'\n');
        
        var aWss = wss.getWss('/');
        aWss.clients.forEach(function (client) {
            var obj = {botStatus: true};
            var updateInfo = JSON.stringify(obj);
            client.send(updateInfo);
        });
    } catch (error) {
        
    }
}

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, '/index.html'));
});

const PORT = 5000;

httpsServer.listen(PORT, (console.log(chalk.yellow(`web server is running now.....`))));


/*var log_file = fs.createWriteStream(__dirname + '/log_arbitrage.txt', { flags: 'w' });
var log_stdout = process.stdout;
console.log = function (d) {
    log_file.write(util.format(d) + '\n');
    log_stdout.write(util.format(d) + '\n');
};

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.WSS_BLOCKS, {
        reconnect: {
            auto: true,
            delay: 5000, // ms
            maxAttempts: 15,
            onTimeout: false
        }
    })
);

const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

const prices = {};
const flashswap = new web3.eth.Contract(FlashswapApi, FLASHSWAP_CONTRACT);

const pairs = require('./src/pairs').getPairs();

const init = async () => {
    console.log('starting: ', JSON.stringify(pairs.map(p => p.name)));

    const transactionSender = TransactionSender.factory(process.env.WSS_BLOCKS.split(','));

    let nonce = await web3.eth.getTransactionCount(admin);
    let gasPrice = await web3.eth.getGasPrice();

    setInterval(async () => {
        nonce = await web3.eth.getTransactionCount(admin);
    }, 1000 * 19);

    setInterval(async () => {
        gasPrice = await web3.eth.getGasPrice()
    }, 1000 * 60 * 3);

    const owner = await flashswap.methods.owner().call();

    console.log(`started: wallet ${admin} - gasPrice ${gasPrice} - contract owner: ${owner}`);

    let handler = async () => {
        const myPrices = await Prices.getPrices();
        if (Object.keys(myPrices).length > 0) {
            for (const [key, value] of Object.entries(myPrices)) {
                prices[key.toLowerCase()] = value;
            }
        }
    };

    await handler();
    setInterval(handler, 1000 * 60 * 5);

    const onBlock = async (block, web3, provider) => {
        const start = performance.now();

        const calls = [];

        const flashswap = new web3.eth.Contract(FlashswapApi, FLASHSWAP_CONTRACT);

        pairs.forEach((pair) => {
            calls.push(async () => {
                const check = await flashswap.methods.check(pair.tokenBorrow, new BigNumber(pair.amountTokenPay * 1e18), pair.tokenPay, pair.sourceRouter, pair.targetRouter).call();

                const profit = check[0];

                let s = pair.tokenPay.toLowerCase();
                const price = prices[s];
                if (!price) {
                    console.log('invalid price', pair.tokenPay);
                    return;
                }

                const profitUsd = profit / 1e18 * price;
                const percentage = (100 * (profit / 1e18)) / pair.amountTokenPay;
                console.log(`[${block.number}] [${new Date().toLocaleString()}]: [${provider}] [${pair.name}] Arbitrage checked! Expected profit: ${(profit / 1e18).toFixed(3)} $${profitUsd.toFixed(2)} - ${percentage.toFixed(2)}%`);

                if (profit > 0) {
                    console.log(`[${block.number}] [${new Date().toLocaleString()}]: [${provider}] [${pair.name}] Arbitrage opportunity found! Expected profit: ${(profit / 1e18).toFixed(3)} $${profitUsd.toFixed(2)} - ${percentage.toFixed(2)}%`);

                    const tx = flashswap.methods.start(
                        block.number + 2,
                        pair.tokenBorrow,
                        new BigNumber(pair.amountTokenPay * 1e18),
                        pair.tokenPay,
                        pair.sourceRouter,
                        pair.targetRouter,
                        pair.sourceFactory,
                    );

                    let estimateGas
                    try {
                        estimateGas = await tx.estimateGas({from: admin});
                    } catch (e) {
                        console.log(`[${block.number}] [${new Date().toLocaleString()}]: [${pair.name}]`, 'gasCost error', e.message);
                        return;
                    }

                    const myGasPrice = new BigNumber(gasPrice).plus(gasPrice * 0.2212).toString();
                    const txCostBNB = Web3.utils.toBN(estimateGas) * Web3.utils.toBN(myGasPrice);

                    let gasCostUsd = (txCostBNB / 1e18) * prices[BNB_MAINNET.toLowerCase()];
                    const profitMinusFeeInUsd = profitUsd - gasCostUsd;

                    if (profitMinusFeeInUsd < 0.6) {
                        console.log(`[${block.number}] [${new Date().toLocaleString()}] [${provider}]: [${pair.name}] stopped: `, JSON.stringify({
                            profit: "$" + profitMinusFeeInUsd.toFixed(2),
                            profitWithoutGasCost: "$" + profitUsd.toFixed(2),
                            gasCost: "$" + gasCostUsd.toFixed(2),
                            duration: `${(performance.now() - start).toFixed(2)} ms`,
                            provider: provider,
                            myGasPrice: myGasPrice.toString(),
                            txCostBNB: txCostBNB / 1e18,
                            estimateGas: estimateGas,
                        }));
                    }

                    if (profitMinusFeeInUsd > 0.6) {
                        console.log(`[${block.number}] [${new Date().toLocaleString()}] [${provider}]: [${pair.name}] and go: `, JSON.stringify({
                            profit: "$" + profitMinusFeeInUsd.toFixed(2),
                            profitWithoutGasCost: "$" + profitUsd.toFixed(2),
                            gasCost: "$" + gasCostUsd.toFixed(2),
                            duration: `${(performance.now() - start).toFixed(2)} ms`,
                            provider: provider,
                        }));

                        const data = tx.encodeABI();
                        const txData = {
                            from: admin,
                            to: flashswap.options.address,
                            data: data,
                            gas: estimateGas,
                            gasPrice: new BigNumber(myGasPrice),
                            nonce: nonce
                        };

                        let number = performance.now() - start;
                        if (number > 1500) {
                            console.error('out of time window: ', number);
                            return;
                        }

                        console.log(`[${block.number}] [${new Date().toLocaleString()}] [${provider}]: sending transactions...`, JSON.stringify(txData))

                        try {
                            await transactionSender.sendTransaction(txData);
                        } catch (e) {
                            console.error('transaction error', e);
                        }
                    }
                }
            })
        })

        try {
            await Promise.all(calls.map(fn => fn()));
        } catch (e) {
            console.log('error', e)
        }

        let number = performance.now() - start;
        if (number > 1500) {
            console.error('warning to slow', number);
        }

        if (block.number % 40 === 0) {
            console.log(`[${block.number}] [${new Date().toLocaleString()}]: alive (${provider}) - took ${number.toFixed(2)} ms`);
        }
    };

    BlockSubscriber.subscribe(process.env.WSS_BLOCKS.split(','), onBlock);
}

init();*/
