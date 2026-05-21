export class EventQueue {
  constructor() {
    this.events = [];
  }

  // scheduleAt: 発火予定のマスタータイム (秒)
  // callback: 発火時の処理
  schedule(scheduleAt, callback) {
    this.events.push({ scheduleAt, callback });
    // TODO: 大量にスケジュールされる場合は挿入ソートやヒープツリーにする
    this.events.sort((a, b) => a.scheduleAt - b.scheduleAt);
  }

  process(currentMasterTime) {
    while (this.events.length > 0 && this.events[0].scheduleAt <= currentMasterTime) {
      const event = this.events.shift();
      event.callback();
    }
  }
}
