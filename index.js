import AMERIA from './lib/ameria.js';
import assert from 'assert';

export default {
  gateway: function (options) {
    assert(options.CLIENT_ID, 'CLIENT_ID is mandatory');
    assert(options.USERNAME, 'USERNAME is mandatory');
    assert(options.PASSWORD, 'PASSWORD is mandatory');
    options = options || {};
    const service = new AMERIA(options);
    return service;
  },
  AMERIA: AMERIA
};
