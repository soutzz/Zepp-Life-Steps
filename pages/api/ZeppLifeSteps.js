const axios = require('axios');
const moment = require('moment');
const { URLSearchParams } = require('url');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Zepp专属请求头
const zeppHeaders = {
  'User-Agent': 'Zepp/5.8.0 (Android; 13; Xiaomi; Redmi K50)',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  'Accept': 'application/json, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Zepp-App-Version': '5.8.0',
  'Zepp-Device-Id': '866788048877777',
  'Zepp-Platform': 'android'
};

/**
 * Zepp账号登录（适配跃我APP）
 * @param {string} account 账号（手机号/邮箱）
 * @param {string} password 密码
 * @returns {object} { accessToken, userId, deviceId }
 */
async function zeppLogin(account, password) {
  try {
    // 步骤1：获取授权token
    const authUrl = 'https://api.zepp.com/v1/oauth2/token';
    const authParams = new URLSearchParams();
    authParams.append('grant_type', 'password');
    authParams.append('username', account);
    authParams.append('password', password);
    authParams.append('client_id', 'zepp_app');
    authParams.append('client_secret', 'zepp_app_secret_2025');
    authParams.append('scope', 'openid profile email phone');

    console.log('Zepp登录 - 步骤1：获取授权token');
    const authRes = await axios.post(authUrl, authParams, {
      headers: zeppHeaders,
      validateStatus: s => s >= 200 && s < 500
    });

    // 错误处理
    if (authRes.data?.error) {
      throw new Error(`Zepp登录失败：${authRes.data.error_description || authRes.data.error}`);
    }
    if (!authRes.data?.access_token) {
      throw new Error('未获取到Zepp access_token：' + JSON.stringify(authRes.data));
    }

    const accessToken = authRes.data.access_token;
    const userId = authRes.data.user_id || authRes.data.sub;
    console.log('Zepp登录成功 - accessToken:', accessToken.substring(0, 20) + '...');

    // 步骤2：获取绑定的设备ID（步数修改需要设备ID）
    const deviceUrl = 'https://api.zepp.com/v1/users/me/devices';
    const deviceRes = await axios.get(deviceUrl, {
      headers: {
        ...zeppHeaders,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    // 取第一个绑定的设备ID
    const deviceId = deviceRes.data?.devices?.[0]?.device_id || 'DEFAULT_ZEPP_DEVICE';
    console.log('Zepp绑定设备ID:', deviceId);

    return {
      accessToken,
      userId,
      deviceId
    };
  } catch (error) {
    console.error('Zepp登录失败:', error.message);
    if (error.response) {
      console.error('错误响应:', error.response.data);
    }
    throw error;
  }
}

/**
 * Zepp账号修改步数
 * @param {string} accessToken Zepp授权token
 * @param {string} deviceId 设备ID
 * @param {number} steps 目标步数
 * @returns {object} 响应结果
 */
async function zeppUpdateSteps(accessToken, deviceId, steps) {
  try {
    const today = moment().format('YYYY-MM-DD');
    console.log('Zepp更新步数 - 日期:', today, '目标步数:', steps);

    // Zepp步数接口（2025新版）
    const stepUrl = 'https://api.zepp.com/v1/health/daily_summary';
    const stepData = new URLSearchParams();
    stepData.append('device_id', deviceId);
    stepData.append('date', today);
    stepData.append('steps', steps);
    stepData.append('calories', Math.floor(steps * 0.05)); // 卡路里（按步数比例）
    stepData.append('distance', Math.floor(steps * 0.7)); // 距离（米）

    const response = await axios.post(stepUrl, stepData, {
      headers: {
        ...zeppHeaders,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      validateStatus: s => s >= 200 && s < 500
    });

    console.log('Zepp步数更新响应:', response.data);

    if (response.data?.code !== 0 && response.data?.error) {
      throw new Error(`步数更新失败：${response.data.message || response.data.error}`);
    }

    return {
      success: true,
      message: 'Zepp步数更新成功',
      data: response.data,
      steps: steps,
      date: today
    };
  } catch (error) {
    console.error('Zepp更新步数失败:', error.message);
    if (error.response) {
      console.error('错误响应:', error.response.data);
    }
    throw error;
  }
}

/**
 * Zepp账号测试入口（一键运行）
 * @param {string} account 账号
 * @param {string} password 密码
 * @param {number} steps 目标步数
 */
async function zeppTestRun(account, password, steps = 30000) {
  try {
    console.log('开始Zepp账号测试 - 目标步数:', steps);
    // 1. 登录Zepp账号
    const { accessToken, userId, deviceId } = await zeppLogin(account, password);
    // 2. 更新步数
    const result = await zeppUpdateSteps(accessToken, deviceId, steps);
    console.log('Zepp测试成功:', result);
    return result;
  } catch (error) {
    console.error('Zepp测试失败:', error.message);
    return { success: false, message: error.message };
  }
}

// 导出函数（兼容你的调用逻辑）
module.exports = {
  login: zeppLogin,       // 映射为login，兼容旧调用
  updateSteps: zeppUpdateSteps, // 映射为updateSteps
  testRun: zeppTestRun    // 一键测试入口
};

// ==================== 调用示例（替换为你的Zepp账号2）====================
zeppTestRun('shuabu666@qq.com', 'shuabu666', 30000);
