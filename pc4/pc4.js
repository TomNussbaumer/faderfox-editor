/*
MIT License

Copyright (c) 2017 Peter Witzel, faderfox-editor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
'use strict';
document.addEventListener('DOMContentLoaded', function() {
  let selectedPreset = 0;
  let sysex = new Sysex({ deviceId: 0x02, maxFileSize: 1024 * 25 });
  // build factory preset data
  let datastore = [];
  for (let i = 0; i < 16; i++) {
    let preset = [];
    for (let j = 0; j < 24; j++) {
      // this is how a controller entry looks like
      preset.push({
        channel: i + 1,
        ccno: j + 1,
        type: 'cc'
      });
    }
    datastore.push(preset);
  }
  let ctrlcontainer = DOM.element('#ctrlcontainer');
  let controlhtml = ctrlcontainer.innerHTML;
  let clipboard = undefined;

  function validateNumber(val, min, max) {
    if (
      typeof val === 'undefined' ||
      isNaN(parseFloat(val)) ||
      !isFinite(val)
    ) {
      return min;
    }
    val = parseInt(val);
    if (val < min) {
      return min;
    } else if (val > max) {
      return max;
    } else {
      return val;
    }
  }

  function updateView() {
    DOM.empty(ctrlcontainer);
    for (let i = 0; i < 24; i++) {
      DOM.addHTML(ctrlcontainer, 'beforeend', controlhtml);
    }
    let index = 0;
    DOM.find(ctrlcontainer, 'section', function(entry) {
      let cindex = index;
      DOM.addClass(entry, datastore[selectedPreset][index].type);
      let elcc = DOM.find(entry, 'input[data-type=ccno]')[0];
      elcc.value = datastore[selectedPreset][index].ccno;
      DOM.on(elcc, 'change', function() {
        var v = validateNumber(elcc.value, 0, 127);
        datastore[selectedPreset][cindex].ccno = v;
        elcc.value = v;
      });
      let elch = DOM.find(entry, 'input[data-type=ch]')[0];
      elch.value = datastore[selectedPreset][index].channel;
      DOM.on(elch, 'change', function() {
        var v = validateNumber(elch.value, 1, 16);
        datastore[selectedPreset][cindex].channel = v;
        elch.value = v;
      });
      DOM.attachInside(entry, '.select li', 'click', function(ev) {
        datastore[selectedPreset][cindex].type = ev.target.className;
        updateView();
      });
      index++;
    });
    DOM.attachInside(ctrlcontainer, '.ctrl input', 'focus', function() {
      this.select();
    });
    DOM.removeClass('#preset li', 'selected');
    DOM.addClass(DOM.all('#preset li')[selectedPreset], 'selected');
  }

  DOM.on('#preset li', 'click', function(ev) {
    let list = DOM.all('#preset li');
    for (let i = 0; i < list.length; i++) {
      if (list[i] === ev.target) {
        selectedPreset = i;
        break;
      }
    }
    updateView();
  });

  function interpret(data) {
    let currentCtrl = {};
    let ctrls = [];
    let dataHandler = function(chunk) {
      if (typeof currentCtrl.type === 'undefined') {
        let typev = chunk.raw[0] & 0xf;
        let channel = chunk.raw[1] & 0xf;
        let type;
        switch (typev) {
          case 0xc:
            type = 'pgm';
            break;
          case 0xe:
            type = 'pb';
            break;
          case 0xb:
          default:
            type = 'cc';
            break;
        }
        currentCtrl.type = type;
        currentCtrl.channel = channel + 1;
      } else {
        currentCtrl.ccno = chunk.val;
        ctrls.push(currentCtrl);
        currentCtrl = {};
      }
    };
    sysex.parseSysexData(data, dataHandler);
    let newdata = [];
    for (let i = 0; i < 16; i++) {
      newdata.push(ctrls.slice(i * 24, i * 24 + 24));
    }
    return newdata;
  }

  function sysexHandler(data) {
    try {
      let newdata = interpret(data);
      MBox.show(SPC4.title_data_received, SPC4.msg_apply, {
        confirmCallback: function() {
          MBox.hide();
          datastore = newdata;
          selectedPreset = 0;
          updateView();
          MBox.show(SPC4.title_data_received, SPC4.msg_data_applied, {
            hideAfter: 5000
          });
        }
      });
    } catch (e) {
      MBox.show(
        SPC4.title_data_received,
        STR.apply(SPC4.$msg_invalid_data, e.message),
        { hideAfter: 10000, type: 'error' }
      );
    }
  }

  updateView();
  var midi = new MIDI('Faderfox PC4', sysexHandler);

  function generateSysexData(editordata) {
    let deviceparts = sysex.hiloNibbles(sysex.deviceId);
    const _typemap = { cc: 0x0b, pgm: 0x0c, pb: 0x0e };
    let result = [
      0xf0,
      0x00,
      0x00,
      0x00,
      0x41,
      deviceparts[0],
      deviceparts[1],
      0x42,
      0x20,
      0x13,
      0x43,
      0x26,
      0x13,
      0x44,
      0x26,
      0x13
    ];
    let crc = 0;
    for (let si = 0; si < editordata.length; si++) {
      for (let ci = 0; ci < editordata[si].length; ci++) {
        let ctrl = editordata[si][ci];
        result.push(0x4d);
        result.push(0x20 + _typemap[ctrl.type]);
        result.push(0x10 + (ctrl.channel - 1));
        crc += (_typemap[ctrl.type] & 0xf) * 16 + ((ctrl.channel - 1) & 0xf);
        result = result.concat(Sysex.PADDING);
        result.push(0x4d);
        let ccv = sysex.hiloNibbles(ctrl.ccno);
        result = result.concat(ccv);
        result = result.concat(Sysex.PADDING);
        crc += (ccv[0] & 0xf) * 16 + (ccv[1] & 0xf);
      }
    }
    crc = crc & 0xffff;
    result.push(0x4b); // CRC high
    result = result.concat(sysex.hiloNibbles((crc & 0xff00) >> 8));
    result.push(0x4c); // CRC low
    result = result.concat(sysex.hiloNibbles(crc & 0x00ff));
    result.push(0x4f); // download stop
    result = result.concat(deviceparts);
    result.push(0xf7);

    return new Uint8Array(result);
  }

  DOM.on('#btntransfer', 'click', function() {
    if (midi.hasOutput()) {
      MBox.show(SPC4.title_send, SPC4.msg_send, {
        buttonLabel: 'Send',
        confirmCallback: function() {
          MBox.hide();
          let data = generateSysexData(datastore);
          midi.sendSysex(data);
        }
      });
    } else {
      MBox.show(STR.midictrl.title_error, STR.midictrl.nooutputs, {
        type: 'error'
      });
    }
  });
  DOM.on('#btnreceive', 'click', function() {
    if (midi.hasInput()) {
      MBox.show(SPC4.title_receive, SPC4.msg_receive);
    } else {
      MBox.show(STR.midictrl.title_error, STR.midictrl.noinputs, {
        type: 'error'
      });
    }
  });
  DOM.on('#btnallchannels', 'click', function() {
    MBox.show(
      SPC4.title_all_pots,
      SPC4.msg_all_pots +
        '<br/><br/><div class="field"><label>Channel:</label>\
                <input name="channel" type="text" size="3" value="" placeholder="#" /></div>',
      {
        buttonLabel: 'Set channels',
        confirmCallback: function() {
          let inval = DOM.element('#mbox input[name=channel]').value;
          if (inval && inval !== '') {
            DOM.all('input[data-type=ch]', function(el) {
              el.value = validateNumber(inval, 1, 16);
              el.dispatchEvent(new Event('change'));
            });
          }
          MBox.hide();
        }
      }
    );
  });
  DOM.on('#btnfilesave', 'click', function() {
    MBox.show(
      SPC4.title_save,
      SPC4.msg_save +
        '<br/><br/><div class="field"><label>Filename:</label><input name="filename" type="text" size="12" value="" placeholder="filename" /><b>.syx</b></div>',
      {
        buttonLabel: 'Save File',
        confirmCallback: function() {
          let filename = DOM.element('#mbox input[name=filename]').value;
          if (filename && filename !== '') {
            let data = generateSysexData(datastore);
            download(data, filename + '.syx', 'application/octet-stream');
          }
          MBox.hide();
        }
      }
    );
  });
  DOM.on('#btnfileload', 'click', function() {
    MBox.show(
      SPC4.title_load,
      SPC4.msg_load + '<br/><br/><input type="file" name="file" />',
      {
        attachHandlers: function(boxelement) {
          DOM.attachInside(boxelement, 'input[type=file]', 'change', function(
            evt
          ) {
            sysex.readFile(evt.target, function(data) {
              if (data) {
                datastore = interpret(data);
                selectedPreset = 0;
                updateView();
                MBox.hide();
                MBox.show(SPC4.title_load, SPC4.msg_loaded, {
                  hideAfter: 5000
                });
              }
            });
          });
        }
      }
    );
  });
  DOM.on('#btncopy', 'click', function() {
    clipboard = datastore[selectedPreset];
    MBox.show(
      SPC4.title_copypaste,
      STR.apply(SPC4.$msg_copy, selectedPreset + 1),
      { hideAfter: 5000 }
    );
  });
  DOM.on('#btnpaste', 'click', function() {
    if (clipboard) {
      MBox.show(
        SPC4.title_copypaste,
        STR.apply(SPC4.$msg_paste, selectedPreset + 1),
        {
          confirmCallback: function() {
            datastore[selectedPreset] = JSON.parse(JSON.stringify(clipboard)); // clone via json
            updateView();
            MBox.hide();
            MBox.show(SPC4.title_copypaste, SPC4.msg_pasted, {
              hideAfter: 5000
            });
          }
        }
      );
    } else {
      MBox.show(SPC4.title_copypaste, SPC4.msg_clipboard_empty, {
        hideAfter: 5000
      });
    }
  });
});
