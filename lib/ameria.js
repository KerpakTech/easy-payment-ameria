import { BaseGateway } from '@easy-payment/base';
import Got from 'got';

// Ameria PaymentsEnum: 5=MainRest (ARCA), 6=Binding (BindingMainRest), 7=PayPal
// MakeBindingPayment / GetBindings require a type enabled on the merchant.
// Sweetailes (and typical ARCA merchants) have MainRest; BindingMainRest (6) is optional.
const PAYMENT_TYPE_MAIN_REST = 5;
const DEFAULT_BINDING_PAYMENT_TYPE = PAYMENT_TYPE_MAIN_REST;
const INIT_SUCCESS_CODE = 1;
const SUCCESS_RESPONSE_CODE = '00';
const ORDER_STATUS = {
  STARTED: 0,
  APPROVED: 1,
  DEPOSITED: 2,
  VOID: 3,
  REFUNDED: 4,
};

class AMERIA extends BaseGateway {
  constructor(options) {
    super();
    this._timeout = options.TIMEOUT || 120000;
    this._endpoint = (options.AMERIA_URL || 'https://services.ameriabank.am/VPOS/').replace(/\/?$/, '/');
    this._clientId = options.CLIENT_ID;
    this._username = options.USERNAME;
    this._password = options.PASSWORD;
  }

  _toOrderId = (orderNumber) => {
    if (typeof orderNumber === 'number' && Number.isInteger(orderNumber) && orderNumber > 0) {
      return orderNumber;
    }
    const asNumber = Number(orderNumber);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      return asNumber;
    }
    const str = String(orderNumber || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) || (Date.now() % 2147483647);
  };

  _toAmeriaAmount = (amount) => {
    const value = Number(amount);
    if (Number.isNaN(value)) {
      return 0;
    }
    // Callers pass minor units (same as idbank); Ameria expects major units.
    return Math.round(value) / 100;
  };

  _mapLang = (language) => {
    const lang = String(language || 'en').toLowerCase();
    if (lang === 'hy' || lang === 'am' || lang === 'arm') {
      return 'am';
    }
    if (lang === 'ru') {
      return 'ru';
    }
    return 'en';
  };

  _payUrl = (paymentId, language) =>
    `${this._endpoint}Payments/Pay?id=${encodeURIComponent(paymentId)}&lang=${this._mapLang(language)}`;

  _isSuccessResponseCode = (code) => String(code) === SUCCESS_RESPONSE_CODE || code === INIT_SUCCESS_CODE;

  _normalizeExpDate = (expDate) => {
    if (!expDate) {
      return expDate;
    }
    const raw = String(expDate).replace(/\D/g, '');
    if (raw.length === 6) {
      return raw;
    }
    if (raw.length === 4) {
      // MMYY → YYYYMM (assume 20xx)
      return `20${raw.slice(2, 4)}${raw.slice(0, 2)}`;
    }
    return raw;
  };

  _normalizeDetails = (data = {}) => {
    const orderStatus = Number(data.OrderStatus);
    const responseCode = data.ResponseCode;
    const success = this._isSuccessResponseCode(responseCode);
    const amount = data.Amount;
    const approvedAmount = data.ApprovedAmount ?? amount;
    const depositedAmount = data.DepositedAmount ?? amount;
    const cardHolderId = data.CardHolderID;
    const bindingId = data.BindingID || cardHolderId;

    return {
      ...data,
      orderId: data.PaymentID || data.MDOrderID,
      orderStatus,
      orderNumber: data.OrderID,
      amount,
      currency: data.Currency,
      approvalCode: data.ApprovalCode,
      authCode: data.ApprovalCode,
      authRefNum: data.rrn,
      actionCode: success ? 0 : data.ActionCode,
      errorCode: success ? 0 : responseCode,
      errorMessage: data.ResponseMessage || data.TrxnDescription,
      bindingInfo: {
        clientId: cardHolderId,
        bindingId,
      },
      cardAuthInfo: {
        pan: data.CardNumber,
        cardholderName: data.ClientName || 'cardholder',
        expiration: this._normalizeExpDate(data.ExpDate),
        approvalCode: data.ApprovalCode,
      },
      paymentAmountInfo: {
        depositedAmount,
        approvedAmount,
        paymentState: data.PaymentState,
        refundedAmount: data.RefundedAmount,
      },
    };
  };

  _requestToBank = async (method, body) => {
    try {
      const { body: data } = await Got.post(`${this._endpoint}api/VPOS/${method}`, {
        timeout: {
          request: this._timeout,
        },
        headers: {
          'content-type': 'application/json',
        },
        json: {
          ...body,
          ClientID: this._clientId,
          Username: this._username,
          Password: this._password,
        },
        responseType: 'json',
      });
      return { hasError: false, data };
    } catch (err) {
      return { hasError: true, err };
    }
  };

  _initPayment = async (order) => {
    const payload = {
      Amount: this._toAmeriaAmount(order.amount),
      OrderID: this._toOrderId(order.orderNumber),
      BackURL: order.returnUrl,
      Description: order.description,
      Currency: order.currency != null ? String(order.currency) : undefined,
      CardHolderID: order.clientId,
      Opaque: order.opaque,
      Timeout: order.timeout,
    };
    return await this._requestToBank('InitPayment', payload);
  };

  _makeBindingPayment = async (order) => {
    const payload = {
      Amount: this._toAmeriaAmount(order.amount),
      OrderID: this._toOrderId(order.orderNumber),
      BackURL: order.returnUrl || 'https://kerpak.com',
      Description: order.description,
      Currency: order.currency != null ? String(order.currency) : undefined,
      CardHolderID: order.clientId || order.bindingId,
      Opaque: order.opaque,
      PaymentType: order.paymentType != null ? order.paymentType : DEFAULT_BINDING_PAYMENT_TYPE,
    };
    return await this._requestToBank('MakeBindingPayment', payload);
  };

  _getPaymentDetails = async (paymentId) => {
    return await this._requestToBank('GetPaymentDetails', { PaymentID: paymentId });
  };

  _confirmPayment = async (order) => {
    const payload = {
      PaymentID: order.orderId,
      Amount: this._toAmeriaAmount(order.amount),
    };
    return await this._requestToBank('ConfirmPayment', payload);
  };

  _cancelPayment = async (order) => {
    return await this._requestToBank('CancelPayment', { PaymentID: order.orderId });
  };

  _refundPayment = async (order) => {
    const payload = {
      PaymentID: order.orderId,
      Amount: this._toAmeriaAmount(order.amount),
    };
    return await this._requestToBank('RefundPayment', payload);
  };

  _getBindings = async (paymentType = DEFAULT_BINDING_PAYMENT_TYPE) => {
    return await this._requestToBank('GetBindings', { PaymentType: paymentType });
  };

  _deactivateBinding = async (cardHolderId, paymentType = DEFAULT_BINDING_PAYMENT_TYPE) => {
    return await this._requestToBank('DeactivateBinding', {
      CardHolderID: cardHolderId,
      PaymentType: paymentType,
    });
  };

  attachCard = async (order) => {
    const registerResponse = await this._initPayment(order);
    if (registerResponse.hasError || Number(registerResponse.data?.ResponseCode) !== INIT_SUCCESS_CODE) {
      registerResponse.hasError = true;
      registerResponse.errorStep = 'InitPayment';
      return registerResponse;
    }

    const paymentId = registerResponse.data.PaymentID;
    return {
      hasError: false,
      data: {
        ...registerResponse.data,
        orderId: paymentId,
        formUrl: this._payUrl(paymentId, order.language),
        errorCode: 0,
      },
    };
  };

  payOrder = async (order) => {
    const payload = (({ useBinding }) => ({ useBinding }))(order);

    if (!payload.useBinding) {
      return new Error('pay order without binding not implemented');
    }

    const payResponse = await this._makeBindingPayment(order);
    if (payResponse.hasError || !this._isSuccessResponseCode(payResponse.data?.ResponseCode)) {
      payResponse.hasError = true;
      payResponse.errorStep = 'MakeBindingPayment';
      return payResponse;
    }

    const paymentId = payResponse.data.PaymentID;
    let res = {
      register: {
        orderId: paymentId,
        ...payResponse.data,
      },
      makeBindingPayment: payResponse.data,
    };

    const details = await this._getPaymentDetails(paymentId);
    if (details.hasError) {
      details.hasError = true;
      details.errorStep = 'GetPaymentDetails';
      return { ...res, ...details };
    }

    const normalized = this._normalizeDetails(details.data);
    res = Object.assign(res, { hasError: false, data: normalized });
    if (normalized.orderStatus !== ORDER_STATUS.DEPOSITED) {
      res.hasError = true;
      res.errorStep = 'GetPaymentDetails';
    }

    return res;
  };

  getOrderStatus = async (order) => {
    const payload = (({ orderId }) => ({ orderId }))(order);
    const data = await this._getPaymentDetails(payload.orderId);
    if (data.hasError) {
      data.hasError = true;
      data.errorStep = 'GetPaymentDetails';
      return data;
    }

    return {
      hasError: false,
      data: this._normalizeDetails(data.data),
    };
  };

  removeCard = async (bindingId) => {
    const data = await this._deactivateBinding(bindingId);
    if (data.hasError || !this._isSuccessResponseCode(data.data?.ResponseCode)) {
      data.hasError = true;
      data.errorStep = 'DeactivateBinding';
      return data;
    }

    return {
      hasError: false,
      data: {
        ...data.data,
        errorCode: '0',
      },
    };
  };

  getBindings = async (clientId) => {
    const data = await this._getBindings();
    if (data.hasError || !this._isSuccessResponseCode(data.data?.ResponseCode)) {
      data.hasError = true;
      data.errorStep = 'GetBindings';
      return data;
    }

    const bindings = (data.data.CardBindingFileds || data.data.CardBindingFields || [])
      .filter((item) => !clientId || item.CardHolderID === clientId)
      .map((item) => ({
        ...item,
        bindingId: item.CardHolderID,
        maskedPan: item.CardPan,
        expiryDate: item.ExpDate,
        clientId: item.CardHolderID,
      }));

    return {
      hasError: false,
      data: {
        ...data.data,
        errorCode: '0',
        bindings,
      },
    };
  };

  freezeOrder = async (order) => {
    const payload = (({ useBinding }) => ({ useBinding }))(order);

    if (!payload.useBinding) {
      return new Error('freeze order without binding not implemented');
    }

    const freezeResponse = await this._makeBindingPayment(order);
    if (freezeResponse.hasError || !this._isSuccessResponseCode(freezeResponse.data?.ResponseCode)) {
      freezeResponse.hasError = true;
      freezeResponse.errorStep = 'MakeBindingPayment';
      return freezeResponse;
    }

    const paymentId = freezeResponse.data.PaymentID;
    let res = {
      registerPreAuth: {
        orderId: paymentId,
        ...freezeResponse.data,
      },
      makeBindingPayment: freezeResponse.data,
    };

    const details = await this._getPaymentDetails(paymentId);
    if (details.hasError) {
      details.hasError = true;
      details.errorStep = 'GetPaymentDetails';
      return { ...res, ...details };
    }

    const normalized = this._normalizeDetails(details.data);
    res = Object.assign(res, { hasError: false, data: normalized });
    // 2-step merchants land on APPROVED (1); 1-step may already be DEPOSITED (2).
    if (![ORDER_STATUS.APPROVED, ORDER_STATUS.DEPOSITED].includes(normalized.orderStatus)) {
      res.hasError = true;
      res.errorStep = 'GetPaymentDetails';
    }

    return res;
  };

  reverseOrderProfile = async (order) => {
    const payload = (({ orderId }) => ({ orderId }))(order);

    const reverseResponse = await this._cancelPayment(order);
    if (reverseResponse.hasError || !this._isSuccessResponseCode(reverseResponse.data?.ResponseCode)) {
      reverseResponse.hasError = true;
      reverseResponse.errorStep = 'CancelPayment';
      return reverseResponse;
    }

    let res = {
      reverse: reverseResponse.data,
    };

    const details = await this._getPaymentDetails(payload.orderId);
    if (details.hasError) {
      details.hasError = true;
      details.errorStep = 'GetPaymentDetails';
      return { ...res, ...details };
    }

    const normalized = this._normalizeDetails(details.data);
    res = Object.assign(res, { hasError: false, data: normalized });
    if (normalized.orderStatus !== ORDER_STATUS.VOID) {
      res.hasError = true;
      res.errorStep = 'GetPaymentDetails';
    }

    return res;
  };

  depositOrder = async (order) => {
    const payload = (({ orderId }) => ({ orderId }))(order);

    const depositResponse = await this._confirmPayment(order);
    if (depositResponse.hasError || !this._isSuccessResponseCode(depositResponse.data?.ResponseCode)) {
      depositResponse.hasError = true;
      depositResponse.errorStep = 'ConfirmPayment';
      return depositResponse;
    }

    let res = {
      deposit: depositResponse.data,
    };

    const details = await this._getPaymentDetails(payload.orderId);
    if (details.hasError) {
      details.hasError = true;
      details.errorStep = 'GetPaymentDetails';
      return { ...res, ...details };
    }

    const normalized = this._normalizeDetails(details.data);
    res = Object.assign(res, { hasError: false, data: normalized });
    if (normalized.orderStatus !== ORDER_STATUS.DEPOSITED) {
      res.hasError = true;
      res.errorStep = 'GetPaymentDetails';
      return res;
    }

    return res;
  };

  refundOrder = async (order) => {
    const payload = (({ orderId }) => ({ orderId }))(order);

    const refundResponse = await this._refundPayment(order);
    if (refundResponse.hasError || !this._isSuccessResponseCode(refundResponse.data?.ResponseCode)) {
      refundResponse.hasError = true;
      refundResponse.errorStep = 'RefundPayment';
      return refundResponse;
    }

    let res = {
      refund: refundResponse.data,
    };

    const details = await this._getPaymentDetails(payload.orderId);
    if (details.hasError) {
      details.hasError = true;
      details.errorStep = 'GetPaymentDetails';
      return { ...res, ...details };
    }

    const normalized = this._normalizeDetails(details.data);
    res = Object.assign(res, { hasError: false, data: normalized });
    if (normalized.orderStatus !== ORDER_STATUS.REFUNDED) {
      res.hasError = true;
      res.errorStep = 'GetPaymentDetails';
    }

    return res;
  };
}

export default AMERIA;
