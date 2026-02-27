const axios = require('axios');
const moment = require('moment');
const { URLSearchParams } = require('url');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 适配新版的请求头
const headers = {
  'User-Agent': 'MiFit/6.10.1 (Android; 13; Xiaomi; Redmi K50)',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Connection': 'Keep-Alive',
  'Accept-Encoding': 'gzip, deflate'
};

/**
 * 新版登录函数（适配华米2025接口）
 * @param {string} account 账号（邮箱/手机号）
 * @param {string} password 密码
 * @returns {object} { loginToken, userId, appToken }
 */
async function loginV2(account, password) {
  try {
    // 步骤1：获取登录票据（替代旧版access code）
    const ticketUrl = 'https://account.huami.com/v2/api/login';
    const ticketParams = new URLSearchParams();
    ticketParams.append('username', account);
    ticketParams.append('password', password);
    ticketParams.append('country_code', 'CN');
    ticketParams.append('app_name', 'com.xiaomi.hm.health');
    ticketParams.append('device_id', '866788048877777'); // 随机有效设备ID
    ticketParams.append('device_model', 'Redmi K50');

    console.log('新版登录 - 步骤1：获取登录票据');
    const ticketRes = await axios.post(ticketUrl, ticketParams, {
      headers,
      validateStatus: s => s >= 200 && s < 500
    });

    // 检测验证码/异常
    if (ticketRes.data?.error === 'verify_required') {
      throw new Error('需要验证码！请先手动登录华米APP完成验证，或使用小米账号授权');
    }
    if (ticketRes.data?.error || !ticketRes.data?.ticket) {
      throw new Error(`登录验证失败：${ticketRes.data?.msg || '账号/密码错误'}`);
    }
    const ticket = ticketRes.data.ticket;
    console.log('获取登录票据成功:', ticket.substring(0, 20) + '...');

    // 步骤2：用票据换login token
    const tokenUrl = 'https://account.huami.com/v2/client/login';
    const tokenParams = new URLSearchParams();
    tokenParams.append('ticket', ticket);
    tokenParams.append('grant_type', 'ticket');
    tokenParams.append('client_id', 'HuaMi');
    tokenParams.append('device_id', '866788048877777');
    tokenParams.append('app_name', 'com.xiaomi.hm.health');
    tokenParams.append('dn', 'api-user.huami.com,api-mifit.huami.com');
    tokenParams.append('lang', 'zh_CN');

    console.log('新版登录 - 步骤2：获取login token');
    const tokenRes = await axios.post(tokenUrl, tokenParams, {
      headers,
      validateStatus: s => s >= 200 && s < 400
    });

    if (!tokenRes.data?.token_info) {
      throw new Error('未获取到token信息：' + JSON.stringify(tokenRes.data));
    }
    const loginToken = tokenRes.data.token_info.login_token;
    const userId = tokenRes.data.token_info.user_id;
    console.log('获取login token成功:', loginToken.substring(0, 20) + '...');

    // 步骤3：获取app token（复用原有逻辑）
    console.log('新版登录 - 步骤3：获取app token');
    const appTokenUrl = `https://account-cn.huami.com/v1/client/app_tokens?app_name=com.xiaomi.hm.health&dn=api-user.huami.com%2Capi-mifit.huami.com&login_token=${loginToken}`;
    const appTokenRes = await axios.get(appTokenUrl, { headers });
    
    if (!appTokenRes.data?.token_info?.app_token) {
      throw new Error('获取appToken失败：' + JSON.stringify(appTokenRes.data));
    }
    const appToken = appTokenRes.data.token_info.app_token;
    console.log('获取app token成功:', appToken.substring(0, 20) + '...');

    return { loginToken, userId, appToken };
  } catch (error) {
    console.error('新版登录失败:', error.message);
    if (error.response) {
      console.error('错误响应:', error.response.data);
    }
    throw error;
  }
}

/**
 * 更新步数（修复参数编码+新版接口适配）
 */
async function updateSteps(loginToken, appToken, steps) {
  try {
    const today = moment().format('YYYY-MM-DD');
    console.log('更新步数 - 日期:', today, '目标步数:', steps);

    // 修复data_json中的步数占位符+URL编码
    let dataJson = `[{"data_hr":"\/\/\/\/\/\/9L\/\/\/\/\/\/\/\/\/\/\/\/Vv\/\/\/\/\/\/\/\/\/\/\/0v\/\/\/\/\/\/\/\/\/\/\/9e\/\/\/\/\/0n\/a\/\/\/S\/\/\/\/\/\/\/\/\/\/\/\/0b\/\/\/\/\/\/\/\/\/\/1FK\/\/\/\/\/\/\/\/\/\/\/\/R\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/9PTFFpaf9L\/\/\/\/\/\/\/\/\/\/\/\/R\/\/\/\/\/\/\/\/\/\/\/\/0j\/\/\/\/\/\/\/\/\/\/\/9K\/\/\/\/\/\/\/\/\/\/\/\/Ov\/\/\/\/\/\/\/\/\/\/\/zf\/\/\/86\/zr\/Ov88\/zf\/Pf\/\/\/0v\/S\/8\/\/\/\/\/\/\/\/\/\/\/\/\/Sf\/\/\/\/\/\/\/\/\/\/\/z3\/\/\/\/\/\/0r\/Ov\/\/\/\/\/\/S\/9L\/zb\/Sf9K\/0v\/Rf9H\/zj\/Sf9K\/0\/\/N\/\/\/\/0D\/Sf83\/zr\/Pf9M\/0v\/Ov9e\/\/\/\/\/\/\/\/\/\/\/\/S\/\/\/\/\/\/\/\/\/\/\/\/zv\/\/z7\/O\/83\/zv\/N\/83\/zr\/N\/86\/z\/\/Nv83\/zn\/Xv84\/zr\/PP84\/zj\/N\/9e\/zr\/N\/89\/03\/P\/89\/z3\/Q\/9N\/0v\/Tv9C\/0H\/Of9D\/zz\/Of88\/z\/\/PP9A\/zr\/N\/86\/zz\/Nv87\/0D\/Ov84\/0v\/O\/84\/zf\/MP83\/zH\/Nv83\/zf\/N\/84\/zf\/Of82\/zf\/OP83\/zb\/Mv81\/zX\/R\/9L\/0v\/O\/9I\/0T\/S\/9A\/zn\/Pf89\/zn\/Nf9K\/07\/N\/83\/zn\/Nv83\/zv\/O\/9A\/0H\/Of8\/\/zj\/PP83\/zj\/S\/87\/zj\/Nv84\/zf\/Of83\/zf\/Of83\/zb\/Nv9L\/zj\/Nv82\/zb\/N\/85\/zf\/N\/9J\/zf\/Nv83\/zj\/Nv84\/0r\/Sv83\/zf\/MP\/\/\/zb\/Mv82\/zb\/Of85\/z7\/Nv8\/\/0r\/S\/85\/0H\/QP9B\/0D\/Nf89\/zj\/Ov83\/zv\/Nv8\/\/0f\/Sv9O\/0ZeXv\/\/\/\/\/\/\/\/\/\/\/1X\/\/\/\/\/\/\/\/\/\/\/9B\/\/\/\/\/\/\/\/\/\/\/\/TP\/\/\/1b\/\/\/\/\/\/0\/\/\/\/\/\/\/\/\/\/\/\/9N\/\/\/\/\/\/\/\/\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+","date":"${today}","data":[{"start":0,"stop":1439,"value":"UA8AUBQAUAwAUBoAUAEAYCcAUBkAUB4AUBgAUCAAUAEAUBkAUAwAYAsAYB8AYB0AYBgAYCoAYBgAYB4AUCcAUBsAUB8AUBwAUBIAYBkAYB8AUBoAUBMAUCEAUCIAYBYAUBwAUCAAUBgAUCAAUBcAYBsAYCUAATIPYD0KECQAYDMAYB0AYAsAYCAAYDwAYCIAYB0AYBcAYCQAYB0AYBAAYCMAYAoAYCIAYCEAYCYAYBsAYBUAYAYAYCIAYCMAUB0AUCAAUBYAUCoAUBEAUC8AUB0AUBYAUDMAUDoAUBkAUC0AUBQAUBwAUA0AUBsAUAoAUCEAUBYAUAwAUB4AUAwAUCcAUCYAUCwKYDUAAUUlEC8IYEMAYEgAYDoAYBAAUAMAUBkAWgAAWgAAWgAAWgAAWgAAUAgAWgAAUBAAUAQAUA4AUA8AUAkAUAIAUAYAUAcAUAIAWgAAUAQAUAkAUAEAUBkAUCUAWgAAUAYAUBEAWgAAUBYAWgAAUAYAWgAAWgAAWgAAWgAAUBcAUAcAWgAAUBUAUAoAUAIAWgAAUAQAUAYAUCgAWgAAUAgAWgAAWgAAUAwAWwAAXCMAUBQAWwAAUAIAWgAAWgAAWgAAWgAAWgAAWgAAWgAAWgAAWREAWQIAUAMAWSEAUDoAUDIAUB8AUCEAUC4AXB4AUA4AWgAAUBIAUA8AUBAAUCUAUCIAUAMAUAEAUAsAUAMAUCwAUBYAWgAAWgAAWgAAWgAAWgAAWgAAUAYAWgAAWgAAWgAAUAYAWwAAWgAAUAYAXAQAUAMAUBsAUBcAUCAAWwAAWgAAWgAAWgAAWgAAUBgAUB4AWgAAUAcAUAwAWQIAWQkAUAEAUAIAWgAAUAoAWgAAUAYAUB0AWgAAWgAAUAkAWgAAWSwAUBIAWgAAUC4AWSYAWgAAUAYAUAoAUAkAUAIAUAcAWgAAUAEAUBEAUBgAUBcAWRYAUA0AWSgAUB4AUDQAUBoAXA4AUA8AUBwAUA8AUA4AUA4AWgAAUAIAUCMAWgAAUCwAUBgAUAYAUAAAUAAAUAAAUAAAUAAAUAAAUAAAUAAAUAAAWwAAUAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAeSEAeQ8AcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcBcAcAAAcAAAcCYOcBUAUAAAUAAAUAAAUAAAUAUAUAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcCgAeQAAcAAAcAAAcAAAcAAAcAAAcAYAcAAAcBgAeQAAcAAAcAAAegAAegAAcAAAcAcAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcCkAeQAAcAcAcAAAcAAAcAwAcAAAcAAAcAIAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcCIAeQAAcAAAcAAAcAAAcAAAcAAAeRwAeQAAWgAAUAAAUAAAUAAAUAAAUAAAcAAAcAAAcBoAeScAeQAAegAAcBkAeQAAUAAAUAAAUAAAUAAAUAAAUAAAcAAAcAAAcAAAcAAAcAAAcAAAegAAegAAcAAAcAAAcBgAeQAAcAAAcAAAcAAAcAAAcAAAcAkAegAAegAAcAcAcAAAcAcAcAAAcAAAcAAAcAAAcA8AeQAAcAAAcAAAeRQAcAwAUAAAUAAAUAAAUAAAUAAAUAAAcAAAcBEAcA0AcAAAWQsAUAAAUAAAUAAAUAAAUAAAcAAAcAoAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAYAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcBYAegAAcAAAcAAAegAAcAcAcAAAcAAAcAAAcAAAcAAAeRkAegAAegAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAEAcAAAcAAAcAAAcAUAcAQAcAAAcBIAeQAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcBsAcAAAcAAAcBcAeQAAUAAAUAAAUAAAUAAAUAAAUBQAcBYAUAAAUAAAUAoAWRYAWTQAWQAAUAAAUAAAUAAAcAAAcAAAcAAAcAAAcAAAcAMAcAAAcAQAcAAAcAAAcAAAcDMAeSIAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcBQAeQwAcAAAcAAAcAAAcAMAcAAAeSoAcA8AcDMAcAYAeQoAcAwAcFQAcEMAeVIAaTYAbBcNYAsAYBIAYAIAYAIAYBUAYCwAYBMAYDYAYCkAYDcAUCoAUCcAUAUAUBAAWgAAYBoAYBcAYCgAUAMAUAYAUBYAUA4AUBgAUAgAUAgAUAsAUAsAUA4AUAMAUAYAUAQAUBIAASsSUDAAUDAAUBAAYAYAUBAAUAUAUCAAUBoAUCAAUBAAUAoAYAIAUAQAUAgAUCcAUAsAUCIAUCUAUAoAUA4AUB8AUBkAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAA","tz":32,"did":"DA932FFFFE8816E7","src":24}],"summary":"{\\"v\\":6,\\"slp\\":{\\"st\\":1628296479,\\"ed\\":1628296479,\\"dp\\":0,\\"lt\\":0,\\"wk\\":0,\\"usrSt\\":-1440,\\"usrEd\\":-1440,\\"wc\\":0,\\"is\\":0,\\"lb\\":0,\\"to\\":0,\\"dt\\":0,\\"rhr\\":0,\\"ss\\":0},\\"stp\\":{\\"ttl\\":${steps},\\"dis\\":10627,\\"cal\\":510,\\"wk\\":41,\\"rn\\":50,\\"runDist\\":7654,\\"runCal\\":397,\\"stage\\":[]},\\"goal\\":8000,\\"tz\\":\\"28800\\"}","source":24,"type":0}]`;
  
    // 替换步数占位符（全局替换）
    dataJson = dataJson.replace(/\$\{steps\}/g, steps);
    // 关键：对data_json进行URL编码，避免特殊字符导致请求失败
    const encodedDataJson = encodeURIComponent(dataJson);

    const timestamp = Date.now();
    const t = Math.floor(Date.now() / 1000).toString();
    const url = `https://api-mifit-cn.huami.com/v1/data/band_data.json?t=${timestamp}`;
    
    // 构造请求数据（新版参数格式）
    const postData = new URLSearchParams();
    postData.append('userid', loginToken);
    postData.append('last_sync_data_time', t);
    postData.append('device_type', '0');
    postData.append('last_deviceid', 'DA932FFFFE8816E7');
    postData.append('data_json', encodedDataJson);

    console.log('更新步数 - 请求URL:', url);
    const response = await axios.post(url, postData, {
      headers: {
        ...headers,
        'apptoken': appToken,
        'x-appid': 'com.xiaomi.hm.health'
      },
      validateStatus: s => s >= 200 && s < 500
    });

    console.log('更新步数 - 响应状态:', response.status);
    console.log('更新步数 - 响应数据:', response.data);

    if (response.data.code !== 1) {
      throw new Error(`步数更新失败：${JSON.stringify(response.data)}`);
    }
    return { success: true, data: response.data };
  } catch (error) {
    console.error('更新步数失败:', error.message);
    if (error.response) {
      console.error('错误响应:', error.response.data);
    }
    throw error;
  }
}

// 测试入口（修正账号密码拼写！）
async function testRun(account, password, targetSteps = 30000) {
  try {
    console.log('开始测试 - 目标步数:', targetSteps);
    // 1. 新版登录
    const { loginToken, userId, appToken } = await loginV2(account, password);
    // 2. 更新步数
    const result = await updateSteps(loginToken, appToken, targetSteps);
    console.log('测试成功:', result);
    return result;
  } catch (error) {
    console.error('测试失败:', error.message);
    return { success: false, message: error.message };
  }
}

// 导出函数
module.exports = {
  loginV2,
  updateSteps,
  testRun
};

// ==================== 调用示例（修正拼写！）====================
// 注意：替换为正确的账号密码（去掉多余的a）
testRun('testshuabu666@qq.com', 'shuabu666', 30000);
