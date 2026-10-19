from transformers import AutoTokenizer

# 固定模型版本；这里只下载 tokenizer，不加载模型权重。
tokenizer = AutoTokenizer.from_pretrained(
    "Qwen/Qwen3-0.6B",
    revision="c1899de289a04d12100db370d81485cdf75e47ca",
)
messages = [
    {"role": "system", "content": "用中文简洁回答。"},
    {"role": "user", "content": "你好。"},
]
print("1. 原始消息：", messages)

# 消息字典 → 模板字符串：加入角色边界与 assistant 回答起点。
prompt = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
    enable_thinking=False,
)
print("2. 模板文本：", repr(prompt))

# 字符串 → 整数 ID 列表。模板已经处理边界，不再自动追加特殊标记。
ids = tokenizer.encode(prompt, add_special_tokens=False)
print("3. token IDs：", ids)

# 同一字符串 → 可传给模型的张量字典，同时带上 attention_mask。
inputs = tokenizer(prompt, add_special_tokens=False, return_tensors="pt")
assert inputs["input_ids"][0].tolist() == ids
print("4. 最终模型输入：", dict(inputs))
print("   input_ids 形状：", tuple(inputs["input_ids"].shape))

# IDs → 字符串：反解只是为了检查输入，没有让模型生成回答。
print("5. 反解检查：", repr(tokenizer.decode(ids, skip_special_tokens=False)))

# 固定 messages，只改变模板开关；这次直接让 apply_chat_template 编码。
for generation, thinking in [(False, True), (True, True), (True, False)]:
    changed = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        return_dict=True,
        add_generation_prompt=generation,
        enable_thinking=thinking,
    )
    changed_ids = changed["input_ids"]
    print(f"\ngeneration={generation}, thinking={thinking}, tokens={len(changed_ids)}")
    print(repr(tokenizer.decode(changed_ids, skip_special_tokens=False)))

# 模板不变，仅把编码后的序列从右侧截到 12 个 token。
tokenizer.truncation_side = "right"
short = tokenizer.apply_chat_template(
    messages,
    tokenize=True,
    return_dict=True,
    add_generation_prompt=True,
    enable_thinking=False,
    truncation=True,
    max_length=12,
)
print("\n截到 12 个 token：", repr(tokenizer.decode(short["input_ids"])))
