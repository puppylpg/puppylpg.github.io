# /// script
# requires-python = ">=3.10"
# dependencies = ["jinja2==3.1.6"]
# ///
"""复核文章中的三种输入格式；只下载配置，不加载权重、不执行推理。

Qwen / DeepSeek：渲染固定版本官方 Jinja 模板。
Llama：根据 Meta 官方简单对话格式重建可见拼写，不冒充 HF 模板实测。
运行：uv run compare_templates.py
"""

import hashlib
import json
from urllib.request import urlopen

from jinja2.sandbox import ImmutableSandboxedEnvironment


MESSAGES = [
    {"role": "system", "content": "用中文简洁回答。"},
    {"role": "user", "content": "你好。"},
]

SOURCES = {
    "Qwen/Qwen3-8B": (
        "b968826d9c46dd6066d109eabc6255188de91218",
        "d5d09f07b48c3086c508b30d1c9114bd1189145b74e982a265350c923acd8101",
    ),
    "deepseek-ai/DeepSeek-V3-0324": (
        "e9b33add76883f293d6bf61f6bd89b497e80e335",
        "7f1394a1791473968ebf8ca25adc2c7f4678388a85c4aff1d4cffca881828734",
    ),
}


def load_config(repo):
    revision, expected_sha256 = SOURCES[repo]
    url = f"https://huggingface.co/{repo}/resolve/{revision}/tokenizer_config.json"
    with urlopen(url, timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError(f"配置内容与固定哈希不一致：{repo}")
    return json.loads(data)


def token_text(value):
    # 配置可能直接存字符串，也可能使用含 content 的对象。
    return value["content"] if isinstance(value, dict) else value


def render_jinja(repo, **options):
    config = load_config(repo)
    env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)
    return env.from_string(config["chat_template"]).render(
        messages=MESSAGES,
        bos_token=token_text(config.get("bos_token")),
        eos_token=token_text(config.get("eos_token")),
        add_generation_prompt=True,
        **options,
    )


def render_meta_reference():
    # 依据 meta-llama/llama-models 的固定提交：
    # 0e0b8c519242d5833d8c11bffc1232b77ad7f301
    # models/llama3_1/prompt_format.md 与 models/llama3/chat_format.py。
    # 这里只重建本例简单文本对话的可见拼写，不执行 tokenizer 编码。
    def header(role):
        return f"<|start_header_id|>{role}<|end_header_id|>\n\n"

    return (
        "<|begin_of_text|>"
        + "".join(
            header(message["role"]) + message["content"] + "<|eot_id|>"
            for message in MESSAGES
        )
        + header("assistant")
    )


def main():
    outputs = [
        ("Qwen3 官方 Jinja 模板实测", render_jinja("Qwen/Qwen3-8B", enable_thinking=False)),
        ("Llama 3.1 Meta 参考格式重建", render_meta_reference()),
        ("DeepSeek V3 官方 Jinja 模板实测", render_jinja("deepseek-ai/DeepSeek-V3-0324")),
    ]
    for name, value in outputs:
        print(name)
        print(value)
        print("repr:", repr(value))
        print()


if __name__ == "__main__":
    main()
