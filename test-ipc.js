const pm2 = require('pm2');
pm2.connect(function(err) {
  if (err) {
    console.error(err);
    process.exit(2);
  }
  pm2.list((err, list) => {
    const bot = list.find(proc => proc.name === 'sentinel-bot');
    if (bot) {
      pm2.sendDataToProcessId({
        type: 'process:msg',
        data: { action: 'TERRITORY_EVENT', payload: { eventType: 'test', data: {} } },
        id: bot.pm_id,
        topic: 'sentinel-bot'
      }, (err, res) => {
        console.log("Sent via pm2 API", err ? err : "Success");
        pm2.disconnect();
      });
    } else {
      console.log("Bot not found");
      pm2.disconnect();
    }
  });
});
