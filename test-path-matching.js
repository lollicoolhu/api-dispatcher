// 测试路径匹配功能
// 运行: node test-path-matching.js

// 复制 getValueByPath 函数
function getValueByPath(obj, path) {
  if (!path || !obj) return undefined;
  
  // 处理简单键（无点号、无括号）
  if (!path.includes('.') && !path.includes('[')) {
    return obj[path];
  }
  
  // 解析路径：支持 a.b.c 和 a[0].b[1] 混合格式
  const keys = [];
  let current = '';
  let inBracket = false;
  
  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === '[') {
      if (current) {
        keys.push({ type: 'key', value: current });
        current = '';
      }
      inBracket = true;
    } else if (char === ']') {
      if (inBracket && current) {
        keys.push({ type: 'index', value: current });
        current = '';
      }
      inBracket = false;
    } else if (char === '.' && !inBracket) {
      if (current) {
        keys.push({ type: 'key', value: current });
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    keys.push({ type: 'key', value: current });
  }
  
  // 遍历路径获取值
  let value = obj;
  for (const key of keys) {
    if (value === undefined || value === null) return undefined;
    
    if (key.type === 'key') {
      value = value[key.value];
    } else if (key.type === 'index') {
      if (key.value === '*') {
        // 通配符：返回数组中所有元素
        if (!Array.isArray(value)) return undefined;
        // 如果后面还有路径，需要继续处理
        const remainingKeys = keys.slice(keys.indexOf(key) + 1);
        if (remainingKeys.length === 0) {
          return value; // 返回整个数组
        }
        // 对数组中每个元素应用剩余路径
        const results = [];
        for (const item of value) {
          let itemValue = item;
          for (const rKey of remainingKeys) {
            if (itemValue === undefined || itemValue === null) break;
            if (rKey.type === 'key') {
              itemValue = itemValue[rKey.value];
            } else if (rKey.type === 'index') {
              if (rKey.value === '*' && Array.isArray(itemValue)) {
                // 嵌套通配符
                itemValue = itemValue;
              } else {
                itemValue = itemValue[rKey.value];
              }
            }
          }
          if (itemValue !== undefined) {
            results.push(itemValue);
          }
        }
        return results.length > 0 ? results : undefined;
      } else {
        // 数字索引
        const index = parseInt(key.value);
        if (isNaN(index) || !Array.isArray(value)) return undefined;
        value = value[index];
      }
    }
  }
  return value;
}

// 测试数据
const testData = {
  name: 'John',
  age: 30,
  user: {
    name: 'Alice',
    email: 'alice@example.com',
    address: {
      city: 'Beijing',
      street: 'Main St'
    }
  },
  items: [
    { id: 1, name: 'Item 1', price: 100 },
    { id: 2, name: 'Item 2', price: 200 },
    { id: 3, name: 'Item 3', price: 300 }
  ],
  tags: ['tag1', 'tag2', 'tag3'],
  nested: {
    array: [
      { values: [1, 2, 3] },
      { values: [4, 5, 6] }
    ]
  }
};

// 测试根级别数组
const rootArrayData = [
  { category: 2, name: 'Report A' },
  { category: 1, name: 'Report B' },
  { category: 3, name: 'Report C' }
];

// 测试用例
const tests = [
  { path: 'name', expected: 'John' },
  { path: 'age', expected: 30 },
  { path: 'user.name', expected: 'Alice' },
  { path: 'user.email', expected: 'alice@example.com' },
  { path: 'user.address.city', expected: 'Beijing' },
  { path: 'user.address.street', expected: 'Main St' },
  { path: 'items[0]', expected: { id: 1, name: 'Item 1', price: 100 } },
  { path: 'items[0].id', expected: 1 },
  { path: 'items[0].name', expected: 'Item 1' },
  { path: 'items[1].price', expected: 200 },
  { path: 'items[*].id', expected: [1, 2, 3] },
  { path: 'items[*].name', expected: ['Item 1', 'Item 2', 'Item 3'] },
  { path: 'tags[0]', expected: 'tag1' },
  { path: 'tags[2]', expected: 'tag3' },
  { path: 'nested.array[0].values[1]', expected: 2 },
  { path: 'nested.array[1].values[2]', expected: 6 },
  { path: 'nonexistent', expected: undefined },
  { path: 'user.nonexistent', expected: undefined },
  { path: 'items[10]', expected: undefined },
];

// 根级别数组测试用例
const rootArrayTests = [
  { path: '[0]', expected: { category: 2, name: 'Report A' } },
  { path: '[0].category', expected: 2 },
  { path: '[0].name', expected: 'Report A' },
  { path: '[1].category', expected: 1 },
  { path: '[2].name', expected: 'Report C' },
  { path: '[*].category', expected: [2, 1, 3] },
  { path: '[*].name', expected: ['Report A', 'Report B', 'Report C'] },
  { path: '[10]', expected: undefined },
  { path: '[0].nonexistent', expected: undefined },
];

// 模拟条件匹配测试
function testConditionMatching() {
  console.log('\n=== 测试条件匹配逻辑 ===');
  
  // 测试数据：包含 category 2 和 1 的数组
  const testBody = [
    { category: 2, param: 0.05 },
    { category: 1, param: 5 }
  ];
  
  // 模拟条件评估函数
  const evalCondition = (data, key, op, value) => {
    const val = getValueByPath(data, key);
    
    if (op === 'exists') {
      return val !== undefined && val !== null && val !== '';
    }
    
    if (Array.isArray(val)) {
      if (op === 'eq') {
        // 如果路径包含通配符 [*]，检查数组中是否有元素等于指定值
        if (key.includes('[*]')) {
          let compareValue = value;
          const numValue = Number(value);
          if (!isNaN(numValue) && String(numValue) === String(value)) {
            compareValue = numValue;
          }
          return val.some(item => item === compareValue || String(item) === String(compareValue));
        }
        // 否则比较整个数组
        try {
          return JSON.stringify(val) === JSON.stringify(JSON.parse(value));
        } catch {
          return JSON.stringify(val) === value;
        }
      }
      if (op === 'contains') {
        return val.some(item => String(item ?? '').includes(String(value ?? '')));
      }
    }
    
    // 标准比较
    if (op === 'eq') return String(val ?? '') === String(value ?? '');
    if (op === 'contains') return String(val ?? '').includes(String(value ?? ''));
    return false;
  };
  
  // 测试用例
  const conditionTests = [
    {
      name: '通配符 eq: [*].category = 1',
      key: '[*].category',
      op: 'eq',
      value: '1',
      expected: true
    },
    {
      name: '通配符 eq: [*].category = 2',
      key: '[*].category',
      op: 'eq',
      value: '2',
      expected: true
    },
    {
      name: '通配符 eq: [*].category = 3',
      key: '[*].category',
      op: 'eq',
      value: '3',
      expected: false
    },
    {
      name: '索引 eq: [0].category = 2',
      key: '[0].category',
      op: 'eq',
      value: '2',
      expected: true
    },
    {
      name: '索引 eq: [0].category = 1',
      key: '[0].category',
      op: 'eq',
      value: '1',
      expected: false
    },
    {
      name: '组合条件: [*].category = 1 AND [*].category = 2',
      conditions: [
        { key: '[*].category', op: 'eq', value: '1' },
        { key: '[*].category', op: 'eq', value: '2' }
      ],
      logic: 'and',
      expected: true
    },
    {
      name: '组合条件: [0].category = 2',
      conditions: [
        { key: '[0].category', op: 'eq', value: '2' }
      ],
      logic: 'and',
      expected: true
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  conditionTests.forEach((test, index) => {
    let result;
    if (test.conditions) {
      // 测试组合条件
      if (test.logic === 'and') {
        result = test.conditions.every(c => evalCondition(testBody, c.key, c.op, c.value));
      } else {
        result = test.conditions.some(c => evalCondition(testBody, c.key, c.op, c.value));
      }
    } else {
      // 测试单个条件
      result = evalCondition(testBody, test.key, test.op, test.value);
    }
    
    const isPass = result === test.expected;
    if (isPass) {
      passed++;
      console.log(`✓ 测试 ${index + 1}: ${test.name}`);
    } else {
      failed++;
      console.log(`✗ 测试 ${index + 1}: ${test.name}`);
      console.log(`  期望: ${test.expected}`);
      console.log(`  实际: ${result}`);
    }
  });
  
  return { passed, failed };
}

// 运行测试
console.log('开始测试路径匹配功能...\n');
console.log('=== 测试对象数据 ===');
let passed = 0;
let failed = 0;

tests.forEach((test, index) => {
  const result = getValueByPath(testData, test.path);
  const resultStr = JSON.stringify(result);
  const expectedStr = JSON.stringify(test.expected);
  const isPass = resultStr === expectedStr;
  
  if (isPass) {
    passed++;
    console.log(`✓ 测试 ${index + 1}: ${test.path}`);
  } else {
    failed++;
    console.log(`✗ 测试 ${index + 1}: ${test.path}`);
    console.log(`  期望: ${expectedStr}`);
    console.log(`  实际: ${resultStr}`);
  }
});

console.log('\n=== 测试根级别数组 ===');
rootArrayTests.forEach((test, index) => {
  const result = getValueByPath(rootArrayData, test.path);
  const resultStr = JSON.stringify(result);
  const expectedStr = JSON.stringify(test.expected);
  const isPass = resultStr === expectedStr;
  
  if (isPass) {
    passed++;
    console.log(`✓ 测试 ${index + 1}: ${test.path}`);
  } else {
    failed++;
    console.log(`✗ 测试 ${index + 1}: ${test.path}`);
    console.log(`  期望: ${expectedStr}`);
    console.log(`  实际: ${resultStr}`);
  }
});

console.log(`\n测试完成: ${passed} 通过, ${failed} 失败`);

// 运行条件匹配测试
const conditionResult = testConditionMatching();
console.log(`\n总计: ${passed + conditionResult.passed} 通过, ${failed + conditionResult.failed} 失败`);
