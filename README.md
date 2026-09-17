# easy-payment-ameria

AmeriaBank vPOS 3.1 adaptor for [easy-payment](https://github.com/KerpakTech/easy-payment-main).

## Installation

```bash
npm install --save easy-payment @easy-payment/ameria
```

## Usage

```javascript
import Gateways from 'easy-payment';
import Ameria from '@easy-payment/ameria';

const settings = {
    AMERIA_URL: 'https://services.ameriabank.am/VPOS/', // optional; defaults to production
    CLIENT_ID: 'MERCHANT_CLIENT_ID',
    USERNAME: 'USERNAME',
    PASSWORD: 'PASSWORD',
};
const client = Gateways.create(Ameria.gateway, settings);
```

## Gateway API

Implements the [BaseGateway](https://github.com/KerpakTech/easy-payment-base) methods used by Kerpak:

| Method | Ameria API |
| --- | --- |
| `attachCard` | `InitPayment` (+ pay form URL) |
| `payOrder` | `MakeBindingPayment` |
| `freezeOrder` | `MakeBindingPayment` (2-step / preauth) |
| `depositOrder` | `ConfirmPayment` |
| `reverseOrderProfile` | `CancelPayment` |
| `refundOrder` | `RefundPayment` |
| `getOrderStatus` | `GetPaymentDetails` |
| `getBindings` | `GetBindings` |
| `removeCard` | `DeactivateBinding` |

Amounts from callers are expected in minor units (same as idbank); the adaptor converts to Ameria decimal amounts.
