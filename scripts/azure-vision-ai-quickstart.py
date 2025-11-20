"""
This code sample shows Prebuilt Read operations with the Azure AI Document Analysis client library
against an existing Form Recognizer (Document Intelligence v3) resource using the bundled `res/V3-0_Reviewed_short-AR.pdf`.

To learn more, please visit the documentation:
https://learn.microsoft.com/azure/ai-services/document-intelligence/how-to-guides/use-sdk-rest-api
"""

import os
from pathlib import Path
import json

from azure.core.credentials import AzureKeyCredential
from azure.ai.formrecognizer import DocumentAnalysisClient
import numpy as np

FR_ENDPOINT_ENV = "FR_ENDPOINT"
FR_KEY_ENV = "FR_KEY"
PDF_PATH = Path("res/V3-0_Reviewed_short-AR.pdf")
OUTPUT_PATH = Path("outputs/azure-read-V3-0_Reviewed_short-AR.pages1-3.read.json")

endpoint = os.environ.get(FR_ENDPOINT_ENV)
key = os.environ.get(FR_KEY_ENV)

if not endpoint or not key:
    raise RuntimeError(
        f"{FR_ENDPOINT_ENV} and {FR_KEY_ENV} environment variables must be set before running this script."
    )

if not PDF_PATH.exists():
    raise FileNotFoundError(f"Document path {PDF_PATH} is missing from the repository.")

def format_bounding_box(bounding_box):
    if not bounding_box:
        return "N/A"
    reshaped_bounding_box = np.array(bounding_box).reshape(-1, 2)
    return ", ".join(["[{}, {}]".format(x, y) for x, y in reshaped_bounding_box])

def analyze_read():
    document_analysis_client = DocumentAnalysisClient(
        endpoint=endpoint, credential=AzureKeyCredential(key)
    )
    with PDF_PATH.open("rb") as pdf_file:
        poller = document_analysis_client.begin_analyze_document(
            "prebuilt-read",
            document=pdf_file,
            pages="1-3",
        )
        result = poller.result()

    output_dict = result.to_dict()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output_dict, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote raw AnalyzeResult JSON to {OUTPUT_PATH}")

    print ("Document contains content: ", result.content)

    for idx, style in enumerate(result.styles):
        print(
            "Document contains {} content".format(
                "handwritten" if style.is_handwritten else "no handwritten"
            )
        )

    for page in result.pages:
        print("----Analyzing Read from page #{}----".format(page.page_number))
        print(
            "Page has width: {} and height: {}, measured with unit: {}".format(
                page.width, page.height, page.unit
            )
        )

        for line_idx, line in enumerate(page.lines):
            print(
                "...Line # {} has text content '{}' within bounding box '{}'".format(
                    line_idx,
                    line.content,
                    format_bounding_box(line.polygon),
                )
            )

        for word in page.words:
            print(
                "...Word '{}' has a confidence of {}".format(
                    word.content, word.confidence
                )
            )

    print("----------------------------------------")


if __name__ == "__main__":
    analyze_read()
