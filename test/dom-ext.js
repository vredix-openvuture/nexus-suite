/* Obsidian patches these onto HTMLElement; the plugin code uses them everywhere.
   Same semantics as Obsidian's, just re-implemented. */
function apply(proto) {
  proto.addClass = function (...c) { this.classList.add(...c.filter(Boolean)); return this; };
  proto.removeClass = function (...c) { this.classList.remove(...c.filter(Boolean)); return this; };
  proto.toggleClass = function (c, on) { this.classList.toggle(c, !!on); return this; };
  proto.hasClass = function (c) { return this.classList.contains(c); };
  proto.setText = function (t) { this.textContent = t; return this; };
  proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
  proto.detach = function () { if (this.parentNode) this.parentNode.removeChild(this); return this; };
  proto.createEl = function (tag, o) { return build(this, tag, o); };
  proto.createDiv = function (o) { return build(this, 'div', typeof o === 'string' ? { cls: o } : o); };
  proto.createSpan = function (o) { return build(this, 'span', typeof o === 'string' ? { cls: o } : o); };
}
function build(parent, tag, o) {
  o = typeof o === 'string' ? { cls: o } : (o || {});
  const el = document.createElement(tag);
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text != null) el.textContent = o.text;
  if (o.type) el.setAttribute('type', o.type);
  if (o.value != null) el.value = o.value;
  if (o.placeholder) el.placeholder = o.placeholder;
  if (o.href) el.href = o.href;
  if (o.attr) for (const k in o.attr) el.setAttribute(k, String(o.attr[k]));
  if (parent) parent.appendChild(el);
  return el;
}
apply(HTMLElement.prototype);
apply(SVGElement.prototype);
window.createDiv = (o) => build(null, 'div', typeof o === 'string' ? { cls: o } : o);
window.createEl = (tag, o) => build(null, tag, o);
window.createSpan = (o) => build(null, 'span', typeof o === 'string' ? { cls: o } : o);
