/**
 * videojs-contrib-media-sources
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Handles communication between the browser-world and the mux.js
 * transmuxer running inside of a WebWorker by exposing a simple
 * message-based interface to a Transmuxer object.
 */
import muxjs from 'mux.js';

/**
 * wireTransmuxerEvents
 * Re-emits tranmsuxer events by converting them into messages to the
 * world outside the worker
 */
const wireTransmuxerEvents = function(transmuxer) {
  transmuxer.on('data', function(segment) {
    // transfer ownership of the underlying ArrayBuffer
    // instead of doing a copy to save memory
    // ArrayBuffers are transferable but generic TypedArrays are not
    /* eslint-disable max-len */
    // see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#Passing_data_by_transferring_ownership_(transferable_objects)
    /* eslint-enable max-len */
    let typedArray = segment.data;

    segment.data = typedArray.buffer;
    postMessage({
      action: 'data',
      segment,
      byteOffset: typedArray.byteOffset,
      byteLength: typedArray.byteLength
    }, [segment.data]);
  });

  if (transmuxer.captionStream) {
    transmuxer.captionStream.on('data', function(caption) {
      postMessage({
        action: 'caption',
        data: caption
      });
    });
  }

  transmuxer.on('done', function(data) {
    postMessage({ action: 'done' });
  });
};

/**
 * All incoming messages route through this hash. If no function exists
 * to handle an incoming message, then we ignore the message.
 */
class MessageHandlers {
  constructor(options) {
    this.options = options || {};
    this.init();
  }

  init() {
    if (this.transmuxer) {
      this.transmuxer.dispose();
    }
    this.transmuxer = new muxjs.mp4.Transmuxer(this.options);
    wireTransmuxerEvents(this.transmuxer);
  }

  /**
   * push
   * Adds data (a ts segment) to the start of the transmuxer pipeline for
   * processing
   */
  push(data) {
    // Cast array buffer to correct type for transmuxer
    let segment = new Uint8Array(data.data, data.byteOffset, data.byteLength);

    this.transmuxer.push(segment);
  }

  /**
   * reset
   * Recreate the transmuxer so that the next segment added via `push`
   * start with a fresh transmuxer
   */
  reset() {
    this.init();
  }

  /**
   * setTimestampOffset
   * Set the value that will be used as the `baseMediaDecodeTime` time for the
   * next segment pushed in. Subsequent segments will have their `baseMediaDecodeTime`
   * set relative to the first based on the PTS values.
   */
  setTimestampOffset(data) {
    let timestampOffset = data.timestampOffset || 0;

    this.transmuxer.setBaseMediaDecodeTime(Math.round(timestampOffset * 90000));
  }

  /**
   * flush
   * Forces the pipeline to finish processing the last segment and emit it's
   * results
   */
  flush(data) {
    this.transmuxer.flush();
  }
}

const Worker = function(self) {
  self.onmessage = function(event) {
    if (event.data.action === 'init' && event.data.options) {
      this.messageHandlers = new MessageHandlers(event.data.options);
      return;
    }

    if (!this.messageHandlers) {
      this.messageHandlers = new MessageHandlers();
    }

    if (event.data && event.data.action && event.data.action !== 'init') {
      if (this.messageHandlers[event.data.action]) {
        this.messageHandlers[event.data.action](event.data);
      }
    }
  };
};

export default (self) => {
  return new Worker(self);
};
