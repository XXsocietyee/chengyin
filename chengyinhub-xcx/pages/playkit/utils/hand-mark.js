/** 反馈句段首的一个「[手写]」加一个可选空格。故事正文的手写段不走这里。 */
function stripLeadingHandMark(text) {
  return String(text == null ? '' : text).replace(/^\[手写\][ \u3000]?/, '');
}

module.exports = { stripLeadingHandMark };
