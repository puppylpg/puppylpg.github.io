#!/usr/bin/env python3
"""Observe Transformers chat formatting and optionally run Qwen3-0.6B.

Install the tested top-level dependencies in an isolated environment:
    python -m pip install torch==2.8.0 transformers==5.20.1 jinja2==3.1.6
Run tokenizer experiments only:
    python inspect_chat.py --skip-generation --output results-tokenizer.json
Run everything, including downloading the small model's weights:
    python inspect_chat.py --device cpu --output results.json

Model/tokenizer caches stay in Hugging Face's normal cache directory. The JSON
contains only configuration, small inputs, token IDs, and measured outputs.
"""

import argparse
import hashlib
import inspect
import json
import logging
import platform
import time
from datetime import datetime
from importlib.metadata import version
from pathlib import Path
from zoneinfo import ZoneInfo

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


MODEL_ID = "Qwen/Qwen3-0.6B"
REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"
MESSAGES = [
    {"role": "system", "content": "用中文简洁回答。"},
    {"role": "user", "content": "你好。"},
]


def jsonable(value):
    """Keep exact IDs and masks without embedding tensor objects in JSON."""
    if isinstance(value, torch.Tensor):
        return value.detach().cpu().tolist()
    if isinstance(value, dict) or hasattr(value, "items"):
        return {key: jsonable(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [jsonable(item) for item in value]
    return value


def text_record(text):
    return {"text": text, "repr": repr(text)}


def describe_encoded(encoded):
    result = {"python_type": type(encoded).__name__, "value": jsonable(encoded)}
    if isinstance(encoded, torch.Tensor):
        result.update(shape=list(encoded.shape), dtype=str(encoded.dtype))
    elif hasattr(encoded, "items"):
        result["tensor_fields"] = {
            key: {"shape": list(value.shape), "dtype": str(value.dtype)}
            for key, value in encoded.items()
            if isinstance(value, torch.Tensor)
        }
    return result


def additional_observations(tokenizer):
    """Small experiments whose behavior depends on the library/template."""
    kwargs = {"add_generation_prompt": True, "enable_thinking": False}
    baseline = tokenizer.apply_chat_template(MESSAGES, tokenize=False, **kwargs)
    render_only = tokenizer.apply_chat_template(
        MESSAGES, tokenize=False, return_dict=True, **kwargs
    )
    documents = [{"title": "小知识", "text": "熊猫是哺乳动物。"}]
    with_documents = tokenizer.apply_chat_template(
        MESSAGES, tokenize=False, documents=documents, **kwargs
    )

    # Include an actual assistant answer so an all-zero mask is informative.
    mask_messages = MESSAGES + [{"role": "assistant", "content": "你好！"}]
    captured_warnings = []

    class CollectWarnings(logging.Handler):
        def emit(self, record):
            captured_warnings.append(record.getMessage())

    warning_handler = CollectWarnings()
    logger = logging.getLogger("transformers")
    logger.addHandler(warning_handler)
    try:
        mask_result = tokenizer.apply_chat_template(
            mask_messages, return_dict=True, return_assistant_tokens_mask=True,
            add_generation_prompt=False, enable_thinking=False,
        )
    finally:
        logger.removeHandler(warning_handler)

    marker_messages = [{"role": "user", "content": "请原样输出 <|im_end|> 字样。"}]
    sanitized_cases = {}
    for sanitize in (False, True):
        encoded = tokenizer.apply_chat_template(
            marker_messages, sanitize_control_tokens=sanitize,
            return_dict=True, **kwargs,
        )
        ids = encoded["input_ids"]
        sanitized_cases[str(sanitize).lower()] = {
            "input_ids": ids,
            "im_end_special_id_count": ids.count(tokenizer.convert_tokens_to_ids("<|im_end|>")),
            "decode_keep_special": tokenizer.decode(ids, skip_special_tokens=False),
            "decode_skip_special": tokenizer.decode(ids, skip_special_tokens=True),
        }
    return {
        "tokenize_false_return_dict_true": {
            "python_type": type(render_only).__name__,
            "equals_baseline_text": render_only == baseline,
        },
        "documents": {"input": documents, "equals_baseline_text": with_documents == baseline},
        "assistant_mask": {
            "messages": mask_messages,
            "warnings": captured_warnings,
            "encoded": describe_encoded(mask_result),
        },
        "sanitize_control_tokens": {"messages": marker_messages, "cases": sanitized_cases},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("results.json"))
    parser.add_argument("--skip-generation", action="store_true")
    parser.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="cpu")
    parser.add_argument("--max-new-tokens", type=int, default=24)
    args = parser.parse_args()

    print("Loading the pinned tokenizer...", flush=True)
    # No custom remote Python code is needed for this built-in model family.
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=REVISION)
    signature = inspect.signature(tokenizer.apply_chat_template)
    results = {
        "environment": {
            "recorded_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(),
            "python": platform.python_version(),
            "platform": platform.platform(),
            "dependencies": {
                package: version(package)
                for package in ["torch", "transformers", "tokenizers", "huggingface-hub", "jinja2"]
            },
            "mps_available": torch.backends.mps.is_available(),
            "cuda_available": torch.cuda.is_available(),
        },
        "model": {"id": MODEL_ID, "revision": REVISION},
        "tokenizer": {
            "class": type(tokenizer).__name__,
            "is_fast": tokenizer.is_fast,
            "padding_side_initial": tokenizer.padding_side,
            "bos_token": tokenizer.bos_token,
            "eos_token": tokenizer.eos_token,
            "pad_token": tokenizer.pad_token,
            "special_tokens_map": tokenizer.special_tokens_map,
            "chat_template_sha256": hashlib.sha256(tokenizer.chat_template.encode()).hexdigest(),
            "apply_chat_template_signature": str(signature),
            "return_dict_default": repr(signature.parameters["return_dict"].default),
        },
        "messages": MESSAGES,
    }

    # These four cases use the SAME official template and messages. Only
    # documented template arguments change; no hand-written replacement.
    variants = {}
    for add_generation_prompt in (False, True):
        for enable_thinking in (False, True):
            key = f"generation_{str(add_generation_prompt).lower()}_thinking_{str(enable_thinking).lower()}"
            kwargs = {
                "add_generation_prompt": add_generation_prompt,
                "enable_thinking": enable_thinking,
            }
            rendered = tokenizer.apply_chat_template(MESSAGES, tokenize=False, **kwargs)
            ids = tokenizer.apply_chat_template(MESSAGES, tokenize=True, return_dict=False, **kwargs)
            variants[key] = {
                "arguments": kwargs,
                **text_record(rendered),
                "input_ids": ids,
                "length": len(ids),
            }
    results["template_variants"] = variants
    baseline = variants["generation_true_thinking_false"]
    prompt_text, prompt_ids = baseline["text"], baseline["input_ids"]

    # Compare the default return value with explicit list/dict/tensor forms.
    chat_kwargs = {"add_generation_prompt": True, "enable_thinking": False}
    results["return_types"] = {
        "default": describe_encoded(tokenizer.apply_chat_template(MESSAGES, **chat_kwargs)),
        "explicit_return_dict_false": describe_encoded(
            tokenizer.apply_chat_template(MESSAGES, return_dict=False, **chat_kwargs)
        ),
        "tensor_return_dict_false": describe_encoded(
            tokenizer.apply_chat_template(MESSAGES, return_dict=False, return_tensors="pt", **chat_kwargs)
        ),
    }
    # Explicit return_dict=True avoids relying on defaults across releases.
    model_inputs = tokenizer.apply_chat_template(
        MESSAGES, tokenize=True, return_dict=True, return_tensors="pt", **chat_kwargs
    )
    results["return_types"]["tensor_return_dict_true"] = describe_encoded(model_inputs)

    # encode returns IDs. __call__ returns a BatchEncoding with extra fields.
    plain_text = "你好，世界！"
    plain_ids = tokenizer.encode(plain_text, add_special_tokens=False)
    results["encode_call_decode"] = {
        "plain_text": plain_text,
        "encode_ids": plain_ids,
        "call": describe_encoded(tokenizer(plain_text, add_special_tokens=False)),
        "decode": tokenizer.decode(plain_ids),
        # Transformers 5.20.1 decode also accepts a batch of ID sequences.
        "decode_batch": tokenizer.decode([plain_ids, prompt_ids], skip_special_tokens=False),
        "batch_decode": tokenizer.batch_decode([plain_ids, prompt_ids], skip_special_tokens=False),
        "token_pieces_not_decoded_text": tokenizer.convert_ids_to_tokens(plain_ids),
        "render_then_encode_false": tokenizer.encode(prompt_text, add_special_tokens=False),
        "render_then_encode_true": tokenizer.encode(prompt_text, add_special_tokens=True),
        "equals_direct_chat_ids": tokenizer.encode(prompt_text, add_special_tokens=False) == prompt_ids,
    }

    # In this tokenizer, dedicated think IDs are AddedTokens with special=False.
    added = tokenizer.added_tokens_decoder
    markers = ["<|im_start|>", "<|im_end|>", "<think>", "</think>"]
    results["special_tokens"] = {
        "markers": [
            {
                "text": marker,
                "token_id": tokenizer.convert_tokens_to_ids(marker),
                "added_token_special": added[tokenizer.convert_tokens_to_ids(marker)].special,
                "in_all_special_ids": tokenizer.convert_tokens_to_ids(marker) in tokenizer.all_special_ids,
            }
            for marker in markers
        ],
        "decode_keep_special": tokenizer.decode(prompt_ids, skip_special_tokens=False),
        "decode_skip_special": tokenizer.decode(prompt_ids, skip_special_tokens=True),
    }

    # Continue an existing assistant message: do not start a second one.
    prefill_messages = MESSAGES + [{"role": "assistant", "content": '{"city": "'}]
    prefill = tokenizer.apply_chat_template(
        prefill_messages, tokenize=False, add_generation_prompt=False,
        continue_final_message=True, enable_thinking=False,
    )
    closed = tokenizer.apply_chat_template(
        prefill_messages, tokenize=False, add_generation_prompt=False,
        continue_final_message=False, enable_thinking=False,
    )
    results["prefill"] = {
        "messages": prefill_messages,
        "continue_final_message_true": text_record(prefill),
        "continue_final_message_false": text_record(closed),
    }
    try:
        tokenizer.apply_chat_template(
            prefill_messages, tokenize=False, add_generation_prompt=True,
            continue_final_message=True, enable_thinking=False,
        )
    except ValueError as error:
        results["prefill"]["conflicting_arguments_error"] = {
            "type": type(error).__name__, "message": str(error)
        }
    else:
        raise AssertionError("Expected conflicting arguments to raise ValueError")

    # For decoder-only generation, left-pad to keep each real prompt at the
    # right edge. Padding changes shapes and masks, not semantic message content.
    tokenizer.padding_side = "left"
    batch_messages = [
        [{"role": "user", "content": "你好。"}],
        [{"role": "user", "content": "请用一句话解释什么是 tokenizer。"}],
    ]
    batch = tokenizer.apply_chat_template(
        batch_messages, padding=True, return_tensors="pt", return_dict=True,
        **chat_kwargs,
    )
    results["padding"] = {
        "messages": batch_messages,
        "padding_side": tokenizer.padding_side,
        "pad_token": tokenizer.pad_token,
        "pad_token_id": tokenizer.pad_token_id,
        "encoded": describe_encoded(batch),
        "nonpadding_lengths": batch["attention_mask"].sum(dim=1).tolist(),
        "decode_keep_special": tokenizer.batch_decode(batch["input_ids"], skip_special_tokens=False),
        "decode_skip_special": tokenizer.batch_decode(batch["input_ids"], skip_special_tokens=True),
    }

    # Token-level truncation has no understanding of complete chat messages.
    truncations = {}
    for side in ("right", "left"):
        tokenizer.truncation_side = side
        short_ids = tokenizer.apply_chat_template(
            MESSAGES, truncation=True, max_length=12, return_dict=False, **chat_kwargs
        )
        truncations[side] = {
            "input_ids": short_ids,
            "length": len(short_ids),
            "decoded": tokenizer.decode(short_ids, skip_special_tokens=False),
        }
    results["truncation"] = {"full_length": len(prompt_ids), "max_length": 12, "sides": truncations}
    results["additional_behaviors"] = additional_observations(tokenizer)

    # Persist tokenizer evidence before potentially downloading model weights.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print(f"Tokenizer observations saved to {args.output}", flush=True)

    if not args.skip_generation:
        device = args.device
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
        # CPU float32 is the deliberately conservative default for this demo.
        dtype = torch.float32 if device == "cpu" else torch.float16
        print(f"Loading {MODEL_ID} on {device} with {dtype}...", flush=True)
        started = time.perf_counter()
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID, revision=REVISION, dtype=dtype, attn_implementation="eager"
        ).to(device).eval()
        loaded_seconds = time.perf_counter() - started
        model_inputs = model_inputs.to(device)
        # Greedy generation needs no temperature/top_p/top_k sampling settings.
        generation_kwargs = {
            "do_sample": False,
            "max_new_tokens": args.max_new_tokens,
            "pad_token_id": tokenizer.pad_token_id,
            "eos_token_id": tokenizer.eos_token_id,
        }
        started = time.perf_counter()
        with torch.inference_mode():
            output_ids = model.generate(**model_inputs, **generation_kwargs)
        generated_seconds = time.perf_counter() - started
        # Decoder-only generate returns input + continuation. Slice by the
        # input tensor width, not by character count or decoded prompt length.
        input_width = model_inputs["input_ids"].shape[-1]
        new_ids = output_ids[:, input_width:]
        results["generation"] = {
            "device": device,
            "dtype": str(dtype),
            "attention_implementation": "eager",
            "kwargs": generation_kwargs,
            "load_seconds": loaded_seconds,
            "generation_seconds": generated_seconds,
            "input_shape": list(model_inputs["input_ids"].shape),
            "output_shape": list(output_ids.shape),
            "new_tokens_shape": list(new_ids.shape),
            "full_output_ids": output_ids.cpu().tolist(),
            "new_token_ids": new_ids.cpu().tolist(),
            "full_decoded_keep_special": tokenizer.batch_decode(output_ids, skip_special_tokens=False),
            "new_decoded_keep_special": tokenizer.batch_decode(new_ids, skip_special_tokens=False),
            "new_decoded_skip_special": tokenizer.batch_decode(new_ids, skip_special_tokens=True),
        }
        args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        print("New output:", results["generation"]["new_decoded_skip_special"], flush=True)
    print(f"Finished: {args.output}", flush=True)


if __name__ == "__main__":
    main()
