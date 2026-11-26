// L02-157: 交上去到回执(或 8 秒没回)之间不再交第二次。分类 / 指认 / 对比 / 每日一签共用。
function holdSubmit(vm) {
  if (vm._sending) return false;
  vm._sending = true;
  clearTimeout(vm._sendGuard);
  vm._sendGuard = setTimeout(() => { vm._sending = false; }, 8000);
  return true;
}
function releaseSubmit(vm) { vm._sending = false; clearTimeout(vm._sendGuard); }
module.exports = { holdSubmit, releaseSubmit };
