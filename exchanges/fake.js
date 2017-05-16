var _ = require('lodash');
var moment = require('moment');
var log = require('../core/log');
var util = require('../core/util.js');


var Trader = function(config) {
  _.bindAll(this);

  if (!_.isObject(config)) {
    util.die('No config set');
  }

  this.exchange = config.fakeExchange; // exchange name to backtest
  this.market = (config.asset + config.currency).toLowerCase(); //market pair to trade
  this.asset = config.asset;
  this.currency = config.currency;
  this.fee = config.fee;

  this.portfolio = {
    asset: config.portfolio.asset, // available asset qty
    currency: config.portfolio.currency // available currency qty
  }

  this.range = {
    start: config.range.start, // start date for backtest
    end: config.range.end // end date for backtest
  }

  this.name = 'Backtest';
  // all orders durring backtest
  // {time:0, action: 'short/long', type: 'market/limit', fee:0, amount: 1.00000000, price:0.00000000, status: 'open/closed/canceled'}
  this.orders = [];
  // all trades durring backtest
  this.trades = [];

  this.lastCandle = {start:0, open:0, high:0, low:0, close:0, volume:0, vwp:0, trades:0, volume_buy:0, trades_buy:0, raw:[]};
}


Trader.prototype.getPortfolio = function(callback) {
  var portfolio = [];
  portfolio.push({name:this.currency, amount:this.portfolio.currency});
  portfolio.push({name:this.asset, amount:this.portfolio.asset});
  callback(false, portfolio);
}

Trader.prototype.getTicker = function(callback) {
  callback({data:'not implemented'});
}

Trader.prototype.getFee = function(callback) {
  callback(false, this.fee);
}

Trader.prototype.buy = function(amount, price, callback) {

  var fee = this.calculateFee(this.fee, price, amount);

  // check if there is enough currency
  if (this.portfolio.currency < (price*amount)+fee) {
    // adjust amount
    // TODO: make proper calculation
    amount = (this.portfolio.currency - fee) / price;
    fee = this.calculateFee(this.fee, price, amount);
  }
  this.portfolio.currencyReserved += (price * amount) + fee;
  this.portfolio.currency -= (price * amount) + fee;

  var order = {
    time: this.lastCandle.start,
    action: 'long',
    type: 'limit',
    fee: fee,
    amount: amount,
    price: price,
    status: 'open'
  }
  this.orders.push(order);

  callback(null, order.time);

}

Trader.prototype.sell = function(amount, price, callback) {
  var fee = this.calculateFee(this.fee, price, amount);

  this.portfolio.assetReserved += amount;
  this.portfolio.asset -= amount;

  var order = {
    time: this.lastCandle.start,
    action: 'short',
    type: 'limit',
    fee: fee,
    amount: amount,
    price: price,
    status: 'open'
  }
  this.orders.push(order);

  callback(null, order.time);
}

Trader.prototype.checkOrder = function(order, callback) {
  var stillThere = _.find(this.orders, function(o) { return (o.id === order && o.status === 'open') });
  callback(null, !stillThere);
}

Trader.prototype.cancelOrder = function(order, callback) {
  var order = _.find(this.orders, function(o) { return (o.id === order && o.status === 'open') });
  if (!order)
      log.error('unable to cancel order', order, '(', err, result, ')');

  order.status = 'canceled';
}

Trader.prototype.getTrades = function(since, callback, descending) {

  var trades = this.trades;
  if (since)
    trades = _.filter(this.trades, function(t) {return (time > since)});


  var result = _.map(trades, t => {
    return {
      date: t.time,
      tid: +t.id,
      price: +t.price,
      amount: +t.amount
    }
  })

  callback(null, result.reverse());

}

// Backtest exchange specifics


// order matching - process candle
Trader.prototype.tick = function(candle) {
  // get open orders
  var openOrders = _.where(this.orders, {status:'open'});
  var volume = {buy:order.volume_buy, sell:candle.volume-candle.volume_buy};
  this.lastCandle = candle;

  _.each(openOrders, function(order) {
    if (order.action=='short') { // sell
      if (order.price <= candle.high) { // order price is lower then high
        if (order.amount > volume.buy && volume.buy > 0) { // order partialy filled
          order.amount -= volume.buy;
          var fee = this.calculateFee(this.fee, order.price, volume.buy);
          var trade = {
            time: candle.start,
            action: order.action,
            type: order.type,
            fee: fee,
            amount: volume.buy,
            price: order.price,
            status: 'partial'
          };
          volume.buy = 0;
          // update portfolio
        } else { // order fully filled
          order.status = 'closed';
          var fee = this.calculateFee(this.fee, order.price, order.amount);
          var trade = {
            time: candle.start,
            action: order.action,
            type: order.type,
            fee: fee,
            amount: order.amount,
            price: order.price,
            status: 'closed'
          };
          volume.buy -= order.amount;
        }
        this.portfolio.currency += (trade.amount*trade.price)-trade.fee;
        this.portfolio.assetReserved -= trade.amount;
        this.trades.push(trade);
      }
    } else { // long - buy
      if (order.price >= candle.low) { // order price is higher then low
        if (order.amount > volume.sell && volume.sell > 0) { // order partialy filled
          order.amount -= volume.sell;
          var fee = this.calculateFee(this.fee, order.price, volume.sell);
          var trade = {
            time: candle.start,
            action: order.action,
            type: order.type,
            fee: fee,
            amount: volume.sell,
            price: order.price,
            status: 'partial'
          };
          volume.sell = 0;
        } else { // order fully filled
          order.status = 'closed';
          var fee = this.calculateFee(this.fee, order.price, volume.buy);
          var trade = {
            time: candle.start,
            action: order.action,
            type: order.type,
            fee: fee,
            amount: order.amount,
            price: order.price,
            status: 'closed'
          };
          volume.sell -= order.amount;
        }
        this.portfolio.currencyReserved -= (trade.amount*trade.price)-trade.fee;
        this.portfolio.asset += (trade.amount);
        this.trades.push(trade);
      }
    };
  })
}


// helper
Trader.prototype.calculateFee = function(fee, price, amount) {
  return price * amount * fee;
}

Trader.prototype.getCapabilities = function() {
  return {};
}


module.exports = Trader;