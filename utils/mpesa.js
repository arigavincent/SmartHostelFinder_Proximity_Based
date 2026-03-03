/**
 * Get M-Pesa OAuth Access Token
 */
async function getAccessToken() {
    try {
        const auth = Buffer.from(
            `${process.env.SAFARICOM_CONSUMER_KEY}:${process.env.SAFARICOM_CONSUMER_SECRET}`
        ).toString('base64');

        const response = await fetch(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`,
                },
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.errorMessage || 'Failed to get access token');
        }

        return data.access_token;
    } catch (error) {
        console.error('M-Pesa Access Token Error:', error.message);
        throw new Error('Failed to get M-Pesa access token');
    }
}

/**
 * Get formatted timestamp for M-Pesa
 * Format: YYYYMMDDHHmmss
 */
function getTimestamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hour}${minute}${second}`;
}

/**
 * Generate Base64 password for M-Pesa
 */
function generatePassword(timestamp) {
    const shortCode = process.env.BUSINESS_SHORT_CODE;
    const passKey = process.env.PASS_KEY;
    return Buffer.from(`${shortCode}${passKey}${timestamp}`).toString('base64');
}

/**
 * Normalize phone number to 254 format
 */
function normalizePhoneNumber(phone) {
    let phoneNumber = String(phone).trim();
    
    if (phoneNumber.startsWith('0')) {
        phoneNumber = '254' + phoneNumber.slice(1);
    } else if (phoneNumber.startsWith('+')) {
        phoneNumber = phoneNumber.slice(1);
    } else if (!phoneNumber.startsWith('254')) {
        if (phoneNumber.length === 9) {
            phoneNumber = '254' + phoneNumber;
        } else {
            throw new Error('Invalid phone number format. Use 2547XXXXXXXX');
        }
    }
    
    if (phoneNumber.length < 12 || phoneNumber.length > 13) {
        throw new Error('Invalid phone number length');
    }
    
    return phoneNumber;
}

/**
 * Initiate STK Push
 */
async function initiateSTKPush(phone, amount, accountRef, callbackUrl) {
    try {
        const accessToken = await getAccessToken();
        const timestamp = getTimestamp();
        const password = generatePassword(timestamp);
        const phoneNumber = normalizePhoneNumber(phone);
        
        const requestBody = {
            BusinessShortCode: process.env.BUSINESS_SHORT_CODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: Math.ceil(amount),
            PartyA: phoneNumber,
            PartyB: process.env.BUSINESS_PAYMENT_CODE || '174379',
            PhoneNumber: phoneNumber,
            CallBackURL: callbackUrl,
            AccountReference: accountRef.substring(0, 12),
            TransactionDesc: accountRef.substring(0, 12),
        };
        
        const response = await fetch(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.errorMessage || 'STK Push request failed',
                responseCode: data.ResponseCode,
            };
        }

        return {
            success: true,
            checkoutRequestID: data.CheckoutRequestID,
            merchantRequestID: data.MerchantRequestID,
            responseCode: data.ResponseCode,
            responseDescription: data.ResponseDescription,
            customerMessage: data.CustomerMessage,
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Query STK Push transaction status
 */
async function querySTKStatus(checkoutRequestID) {
    try {
        const accessToken = await getAccessToken();
        const timestamp = getTimestamp();
        const password = generatePassword(timestamp);

        const response = await fetch(
            'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    BusinessShortCode: process.env.BUSINESS_SHORT_CODE,
                    Password: password,
                    Timestamp: timestamp,
                    CheckoutRequestID: checkoutRequestID,
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.errorMessage || 'Query request failed',
            };
        }

        return {
            success: true,
            resultCode: String(data.ResultCode),
            resultDesc: data.ResultDesc,
            responseCode: data.ResponseCode,
        };
    } catch (error) {
        console.error('STK Query Error:', error.message);
        return {
            success: false,
            error: error.message,
        };
    }
}

module.exports = {
    getAccessToken,
    getTimestamp,
    generatePassword,
    normalizePhoneNumber,
    initiateSTKPush,
    querySTKStatus,
};