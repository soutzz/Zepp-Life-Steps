const axios = require('axios');
const moment = require('moment');
const { URLSearchParams } = require('url');
// 新增：禁用HTTPS证书验证（部分环境会因证书问题失败）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 配置请求头（补充关键字段）
const headers = {
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 9; MI 6 MIUI/20.6.18)',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  'Accept': '*/*',
  'Connection': 'Keep-Alive',
  'Accept-Encoding': 'gzip, deflate'
};

// 获取登录code（优化正则匹配）
async function getCode(location) {
  if (!location) return null;
  // 优化正则：兼容不同格式的重定向URL
  const codePattern = /access=([^&]+)/;
  const match = location.match(codePattern);
  return match ? match[1] : null;
}

// 登录获取token（核心修复）
async function login(account, password) {
  try {
    const isPhone = /^\+?\d+$/.test(account);
    console.log('登录账号类型:', isPhone ? '手机号' : '邮箱');
    console.log('登录账号:', account);

    // 第一步：获取access code（修复参数序列化）
    const url1 = `https://api-user.huami.com/registrations/${account}/tokens`;
    // 关键：用URLSearchParams序列化表单数据
    const params1 = new URLSearchParams();
    params1.append('client_id', 'HuaMi');
    params1.append('password', password);
    params1.append('redirect_uri', 'https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html');
    params1.append('token', 'access');
    if (isPhone) {
      params1.append('phone_number', account);
    } else {
      params1.append('email', account); // 补充邮箱字段
    }

    console.log('第一步请求URL:', url1);
    console.log('第一步请求数据:', params1.toString());

    try {
      // 第一次请求：主动允许重定向，获取最终的location
      const response1 = await axios.post(url1, params1, {
        headers: headers,
        maxRedirects: 5, // 允许重定向（关键）
        validateStatus: (status) => status >= 200 && status < 500,
        followRedirect: true
      });
      // 从响应的request.res.responseUrl获取最终重定向地址
      const location = response1.request?.res?.responseUrl || response1.headers.location;
      console.log('最终重定向URL:', location);

      const code = await getCode(location);
      if (!code) {
        console.error('获取access code失败 - 重定向URL中无code');
        console.error('重定向URL详情:', location);
        throw new Error('获取access code失败');
      }
      console.log('获取到的code:', code);

      // 第二步：获取login token（参数不变，仅优化日志）
      const url2 = 'https://account.huami.com/v2/client/login';
      const params2 = new URLSearchParams();
      params2.append('allow_registration', 'false');
      params2.append('app_name', 'com.xiaomi.hm.health');
      params2.append('app_version', '6.3.5');
      params2.append('code', code);
      params2.append('country_code', 'CN');
      params2.append('device_id', '2C8B4939-0CCD-4E94-8CBA-CB8EA6E613A1');
      params2.append('device_model', 'phone');
      params2.append('dn', 'api-user.huami.com%2Capi-mifit.huami.com%2Capp-analytics.huami.com');
      params2.append('grant_type', 'access_token');
      params2.append('lang', 'zh_CN');
      params2.append('os_version', '1.5.0');
      params2.append('source', 'com.xiaomi.hm.health');
      params2.append('third_name', isPhone ? 'huami_phone' : 'email');

      console.log('第二步请求URL:', url2);
      console.log('第二步请求数据:', params2.toString());

      const response2 = await axios.post(url2, params2, {
        headers,
        validateStatus: (status) => status >= 200 && status < 400
      });

      console.log('第二步响应数据:', response2.data);

      if (!response2.data?.token_info) {
        throw new Error('登录失败：未获取到token信息');
      }

      const loginToken = response2.data.token_info.login_token;
      const userId = response2.data.token_info.user_id;

      if (!loginToken || !userId) {
        throw new Error('登录失败：token信息不完整');
      }

      console.log('登录成功, loginToken:', loginToken, 'userId:', userId);
      return { loginToken, userId };
    } catch (redirectError) {
      console.error('重定向请求失败:', redirectError.message);
      if (redirectError.response) {
        console.error('错误响应状态码:', redirectError.response.status);
        console.error('错误响应数据:', redirectError.response.data);
      }
      throw redirectError;
    }
  } catch (error) {
    console.error('登录失败:', error.message);
    if (error.response) {
      console.error('错误响应状态码:', error.response.status);
      console.error('错误响应数据:', error.response.data);
    }
    throw error;
  }
}

// 保留原有getAppToken、updateSteps等函数（无需修改）
async function getAppToken(loginToken) {
  try {
    const url = `https://account-cn.huami.com/v1/client/app_tokens?app_name=com.xiaomi.hm.health&dn=api-user.huami.com%2Capi-mifit.huami.com%2Capp-analytics.huami.com&login_token=${loginToken}`;
    console.log('获取appToken请求URL:', url);

    const response = await axios.get(url, {
      headers,
      validateStatus: (status) => status >= 200 && status < 400
    });

    console.log('获取appToken响应数据:', response.data);

    if (!response.data?.token_info?.app_token) {
      throw new Error('获取appToken失败：token信息不完整');
    }

    const appToken = response.data.token_info.app_token;
    console.log('获取appToken成功:', appToken);
    return appToken;
  } catch (error) {
    console.error('获取appToken失败:', error.message);
    if (error.response) {
      console.error('错误响应数据:', error.response.data);
    }
    throw error;
  }
}

async function updateSteps(loginToken, appToken, steps) {
  try {
    const today = moment().format('YYYY-MM-DD');
    console.log('当前日期:', today);
    console.log('目标步数:', steps);

    // 替换steps占位符（关键）
    const dataJson = `[{"data_hr":"\/\/\/\/\/\/9L\/\/\/\/\/\/\/\/\/\/\/\/Vv\/\/\/\/\/\/\/\/\/\/\/0v\/\/\/\/\/\/\/\/\/\/\/9e\/\/\/\/\/0n\/a\/\/\/S\/\/\/\/\/\/\/\/\/\/\/\/0b\/\/\/\/\/\/\/\/\/\/1FK\/\/\/\/\/\/\/\/\/\/\/\/R\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/9PTFFpaf9L\/\/\/\/\/\/\/\/\/\/\/\/R\/\/\/\/\/\/\/\/\/\/\/\/0j\/\/\/\/\/\/\/\/\/\/\/9K\/\/\/\/\/\/\/\/\/\/\/\/Ov\/\/\/\/\/\/\/\/\/\/\/zf\/\/\/86\/zr\/Ov88\/zf\/Pf\/\/\/0v\/S\/8\/\/\/\/\/\/\/\/\/\/\/\/\/Sf\/\/\/\/\/\/\/\/\/\/\/z3\/\/\/\/\/\/0r\/Ov\/\/\/\/\/\/S\/9L\/zb\/Sf9K\/0v\/Rf9H\/zj\/Sf9K\/0\/\/N\/\/\/\/0D\/Sf83\/zr\/Pf9M\/0v\/Ov9e\/\/\/\/\/\/\/\/\/\/\/\/S\/\/\/\/\/\/\/\/\/\/\/\/zv\/\/z7\/O\/83\/zv\/N\/83\/zr\/N\/86\/z\/\/Nv83\/zn\/Xv84\/zr\/PP84\/zj\/N\/9e\/zr\/N\/89\/03\/P\/89\/z3\/Q\/9N\/0v\/Tv9C\/0H\/Of9D\/zz\/Of88\/z\/\/PP9A\/zr\/N\/86\/zz\/Nv87\/0D\/Ov84\/0v\/O\/84\/zf\/MP83\/zH\/Nv83\/zf\/N\/84\/zf\/Of82\/zf\/OP83\/zb\/Mv81\/zX\/R\/9L\/0v\/O\/9I\/0T\/S\/9A\/zn\/Pf89\/zn\/Nf9K\/07\/N\/83\/zn\/Nv83\/zv\/O\/9A\/0H\/Of8\/\/zj\/PP83\/zj\/S\/87\/zj\/Nv84\/zf\/Of83\/zf\/Of83\/zb\/Nv9L\/zj\/Nv82\/zb\/N\/85\/zf\/N\/9J\/zf\/Nv83\/zj\/Nv84\/0r\/Sv83\/zf\/MP\/\/\/zb\/Mv82\/zb\/Of85\/z7\/Nv8\/\/0r\/S\/85\/0H\/QP9B\/0D\/Nf89\/zj\/Ov83\/zv\/Nv8\/\/0f\/Sv9O\/0ZeXv\/\/\/\/\/\/\/\/\/\/\/1X\/\/\/\/\/\/\/\/\/\/\/9B\/\/\/\/\/\/\/\/\/\/\/\/TP\/\/\/1b\/\/\/\/\/\/0\/\/\/\/\/\/\/\/\/\/\/\/9N\/\/\/\/\/\/\/\/\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+\/v7+","date":"${today}","data":[{"start":0,"stop":1439,"value":"UA8AUBQAUAwAUBoAUAEAYCcAUBkAUB4AUBgAUCAAUAEAUBkAUAwAYAsAYB8AYB0AYBgAYCoAYBgAYB4AUCcAUBsAUB8AUBwAUBIAYBkAYB8AUBoAUBMAUCEAUCIAYBYAUBwAUCAAUBgAUCAAUBcAYBsAYCUAATIPYD0KECQAYDMAYB0AYAsAYCAAYDwAYCIAYB0AYBcAYCQAYB0AYBAAYCMAYAoAYCIAYCEAYCYAYBsAYBUAYAYAYCIAYCMAUB0AUCAAUBYAUCoAUBEAUC8AUB0AUBYAUDMAUDoAUBkAUC0AUBQAUBwAUA0AUBsAUAoAUCEAUBYAUAwAUB4AUAwAUCcAUCYAUCwKYDUAAUUlEC8IYEMAYEgAYDoAYBAAUAMAUBkAWgAAWgAAWgAAWgAAWgAAUAgAWgAAUBAAUAQAUA4AUA8AUAkAUAIAUAYAUAcAUAIAWgAAUAQAUAkAUAEAUBkAUCUAWgAAUAYAUBEAWgAAUBYAWgAAUAYAWgAAWgAAWgAAWgAAUBcAUAcAWgAAUBUAUAoAUAIAWgAAUAQAUAYAUCgAWgAAUAgAWgAAWgAAUAwAWwAAXCMAUBQAWwAAUAIAWgAAWgAAWgAAWgAAWgAAWgAAWgAAWgAAWREAWQIAUAMAWSEAUDoAUDIAUB8AUCEAUC4AXB4AUA4AWgAAUBIAUA8AUBAAUCUAUCIAUAMAUAEAUAsAUAMAUCwAUBYAWgAAWgAAWgAAWgAAWgAAWgAAUAYAWgAAWgAAWgAAUAYAWwAAWgAAUAYAXAQAUAMAUBsAUBcAUCAAWwAAWgAAWgAAWgAAWgAAUBgAUB4AWgAAUAcAUAwAWQIAWQkAUAEAUAIAWgAAUAoAWgAAUAYAUB0AWgAAWgAAUAkAWgAAWSwAUBIAWgAAUC4AWSYAWgAAUAYAUAoAUAkAUAIAUAcAWgAAUAEAUBEAUBgAUBcAWRYAUA0AWSgAUB4AUDQAUBoAXA4AUA8AUBwAUA8AUA4AUA4AWgAAUAIAUCMAWgAAUCwAUBgAUAYAUAAAUAAAUAAAUAAAUAAAUAAAUAAAUAAAUAAAWwAAUAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAeSEAeQ8AcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcBcAcAAAcAAAcCYOcBUAUAAAUAAAUAAAUAAAUAUAUAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcCgAeQAAcAAAcAAAcAAAcAAAcAAAcAYAcAAAcBgAeQAAcAAAcAAAegAAegAAcAAAcAcAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcCkAeQAAcAcAcAAAcAAAcAwAcAAAcAAAcAIAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcCIAeQAAcAAAcAAAcAAAcAAAcAAAeRwAeQAAWgAAUAAAUAAAUAAAUAAAUAAAcAAAcAAAcBoAeScAeQAAegAAcBkAeQAAUAAAUAAAUAAAUAAAUAAAUAAAcAAAcAAAcAAAcAAAcAAAcAAAegAAegAAcAAAcAAAcBgAeQAAcAAAcAAAcAAAcAAAcAAAcAkAegAAegAAcAcAcAAAcAcAcAAAcAAAcAAAcAAAcA8AeQAAcAAAcAAAeRQAcAwAUAAAUAAAUAAAUAAAUAAAUAAAcAAAcBEAcA0AcAAAWQsAUAAAUAAAUAAAUAAAUAAAcAAAcAoAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAYAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcBYAegAAcAAAcAAAegAAcAcAcAAAcAAAcAAAcAAAcAAAeRkAegAAegAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAEAcAAAcAAAcAAAcAUAcAQAcAAAcBIAeQAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcBsAcAAAcAAAcBcAeQAAUAAAUAAAUAAAUAAAUAAAUBQAcBYAUAAAUAAAUAoAWRYAWTQAWQAAUAAAUAAAUAAAcAAAcAAAcAAAcAAAcAAAcAMAcAAAcAQAcAAAcAAAcAAAcDMAeSIAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcBQAeQwAcAAAcAAAcAAAcAMAcAAAeSoAcA8AcDMAcAYAeQoAcAwAcFQAcEMAeVIAaTYAbBcNYAsAYBIAYAIAYAIAYBUAYCwAYBMAYDYAYCkAYDcAUCoAUCcAUAUAUBAAWgAAYBoAYBcAYCgAUAMAUAYAUBYAUA4AUBgAUAgAUAgAUAsAUAsAUA4AUAMAUAYAUAQAUBIAASsSUDAAUDAAUBAAYAYAUBAAUAUAUCAAUBoAUCAAUBAAUAoAYAIAUAQAUAgAUCcAUAsAUCIAUCUAUAoAUA4AUB8AUBkAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAAfgAA","tz":32,"did":"DA932FFFFE8816E7","src":24}],"summary":"{\\"v\\":6,\\"slp\\":{\\"st\\":1628296479,\\"ed\\":1628296479,\\"dp\\":0,\\"lt\\":0,\\"wk\\":0,\\"usrSt\\":-1440,\\"usrEd\\":-1440,\\"wc\\":0,\\"is\\":0,\\"lb\\":0,\\"to\\":0,\\"dt\\":0,\\"rhr\\":0,\\"ss\\":0},\\"stp\\":{\\"ttl\\":${steps},\\"dis\\":10627,\\"cal\\":510,\\"wk\\":41,\\"rn\\":50,\\"runDist\\":7654,\\"runCal\\":397,\\"stage\\":[]},\\"goal\\":8000,\\"tz\\":\\"28800\\"}","source":24,"type":0}]`.replace(/\$\{steps\}/g, steps);

    const timestamp = new Date().getTime();
    const t = String(parseInt(Date.now() / 1000));

    const url = `https://api-mifit-cn2.huami.com/v1/data/band_data.json?t=${timestamp}`;
    const data = `userid=${loginToken}&last_sync_data_time=${t}&device_type=0&last_deviceid=DA932FFFFE8816E7&data_json=${encodeURIComponent(dataJson)}`;

    console.log('更新步数请求URL:', url);
    console.log('更新步数请求数据长度:', data.length);

    const response = await axios.post(url, data, {
      headers: {
        ...headers,
        apptoken: appToken
      },
      validateStatus: (status) => status >= 200 && status < 400
    });

    console.log('更新步数响应状态码:', response.status);
    console.log('更新步数响应数据:', response.data);

    if (response.data.code !== 1) {
      throw new Error('更新步数失败: ' + JSON.stringify(response.data));
    }

    console.log('更新步数成功');
    return response.data;
  } catch (error) {
    console.error('更新步数失败:', error.message);
    if (error.response) {
      console.error('错误响应状态码:', error.response.status);
      console.error('错误响应数据:', error.response.data);
    }
    throw error;
  }
}

// 测试函数（方便你快速验证）
async function testRun(account, password, targetSteps = 10000) {
  try {
    // 1. 登录
    const { loginToken, userId } = await login(account, password);
    // 2. 获取appToken
    const appToken = await getAppToken(loginToken);
    // 3. 更新步数
    const result = await updateSteps(loginToken, appToken, targetSteps);
    console.log('测试运行成功:', result);
    return result;
  } catch (error) {
    console.error('测试运行失败:', error.message);
    return null;
  }
}

// 导出函数
module.exports = {
  login,
  getAppToken,
  updateSteps,
  testRun
};

// 调用示例（替换为你的账号密码）
testRun('testshubu666@qq.com', 'shubu666', 30000);
