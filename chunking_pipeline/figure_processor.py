"""Figure processing wrapper for ChunkingTests.

Wraps PolicyAsCode's FigureProcessor to handle image processing,
result serialization, and storage of annotated images and JSON results.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from loguru import logger

if TYPE_CHECKING:
    from src.figure_processing import FigureProcessor
    from src.services.figure_processing_service import FigureProcessingService


class FigureProcessorWrapper:
    """Wrapper for PolicyAsCode's FigureProcessor with result persistence."""

    def __init__(self) -> None:
        """Initialize the processor lazily to avoid import overhead."""
        self._processor: FigureProcessor | None = None
        self._service: FigureProcessingService | None = None

    def _get_processor(self) -> FigureProcessor:
        """Lazy-load the FigureProcessor from PolicyAsCode."""
        if self._processor is None:
            try:
                from src.figure_processing import FigureProcessor

                self._processor = FigureProcessor()
                logger.info("FigureProcessor initialized from PolicyAsCode")
            except ImportError as e:
                raise ImportError(
                    "FigureProcessor not available. Ensure PolicyAsCode is installed "
                    "from the feature/figure-vision-pr5c-api-endpoints branch."
                ) from e
        return self._processor

    def _get_service(self) -> FigureProcessingService:
        """Lazy-load FigureProcessingService for SAM3 annotations.

        The service is used as an adapter - its _prepare_sam3_annotations method
        doesn't use the database session, so we can pass None.
        """
        if self._service is None:
            try:
                from src.services.figure_processing_service import (
                    FigureProcessingService,
                )

                # Pass None for session - _prepare_sam3_annotations doesn't use it
                self._service = FigureProcessingService(session=None)  # type: ignore[arg-type]
                logger.info("FigureProcessingService initialized for SAM3 annotations")
            except ImportError as e:
                raise ImportError(
                    "FigureProcessingService not available. Ensure PolicyAsCode is installed "
                    "from the feature/figure-vision-pr5c-api-endpoints branch."
                ) from e
        return self._service

    def process_figure(
        self,
        image_path: str | Path,
        ocr_text: str = "",
        *,
        run_id: str | None = None,
        text_positions: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Process a single figure image through the vision pipeline.

        Args:
            image_path: Path to the figure image (PNG/JPEG)
            ocr_text: OCR text extracted from the figure (if available)
            run_id: Optional run identifier for tracking
            text_positions: Text position data for SAM3 annotations

        Returns:
            Dict containing:
                - figure_type: Classification (flowchart/other)
                - confidence: Classification confidence score
                - processed_content: Mermaid code for flowcharts, description otherwise
                - raw_ocr_text: Original OCR text
                - description: Figure description
                - processing_notes: Any notes from processing
                - step1_duration_ms: Classification time
                - step2_duration_ms: Structure/Mermaid generation time
        """
        from src.figure_processing import FigureProcessor as PolicyFigureProcessor
        from src.figure_processing import FigureType
        from src.figure_processing.classifier import FigureClassification

        processor = self._get_processor()
        service = self._get_service()
        image_path = Path(image_path)

        # Classify first to determine if SAM3 annotations are needed
        classification = processor.classify_figure(image_path, ocr_text=ocr_text)

        shape_positions = None
        processing_image_path = image_path

        if classification.figure_type in PolicyFigureProcessor.FLOWCHART_TYPES:
            # Detect flow direction for SAM3
            direction = "LR"
            try:
                from src.prompts.figure_direction_prompt import detect_direction

                direction_result = detect_direction(image_path)
                direction = direction_result.direction.value
                logger.debug(f"Detected flow direction: {direction}")
            except Exception as e:
                logger.warning(f"Direction detection failed, using default LR: {e}")

            # Use service's SAM3 annotation method (doesn't need DB session)
            try:
                annotated_path, shape_positions, _ = service._prepare_sam3_annotations(
                    image_path, text_positions, direction, run_id
                )

                if annotated_path and shape_positions:
                    processing_image_path = annotated_path
                    logger.info(
                        f"SAM3 annotations prepared: {len(shape_positions)} shapes"
                    )
                else:
                    # SAM3 didn't return positions - fall back to "other" type
                    logger.warning("SAM3 returned no shape positions, treating as non-flowchart")
                    classification = FigureClassification(
                        figure_type=FigureType.OTHER,
                        confidence=classification.confidence,
                        reasoning="SAM3 annotation failed, treating as non-flowchart",
                    )
            except Exception as e:
                # SAM3 failed - fall back to "other" type
                logger.warning(f"SAM3 annotation failed: {e}, treating as non-flowchart")
                classification = FigureClassification(
                    figure_type=FigureType.OTHER,
                    confidence=classification.confidence,
                    reasoning=f"SAM3 annotation failed: {e}",
                )

        # Call processor with shape_positions (if flowchart) and force_type
        result = processor.process_figure(
            image_path=processing_image_path,
            ocr_text=ocr_text,
            shape_positions=shape_positions,
            text_positions=text_positions,
            run_id=run_id,
            force_type=classification.figure_type,
        )
        return result.model_dump()

    def classify_figure(
        self,
        image_path: str | Path,
        ocr_text: str = "",
    ) -> dict[str, Any]:
        """Classify a figure without full processing.

        Args:
            image_path: Path to the figure image
            ocr_text: OCR text for additional context

        Returns:
            Dict with figure_type, confidence, and reasoning
        """
        processor = self._get_processor()
        result = processor.classify_figure(Path(image_path), ocr_text=ocr_text)
        return result.model_dump()

    def process_and_save(
        self,
        image_path: str | Path,
        output_dir: str | Path,
        element_id: str,
        ocr_text: str = "",
        *,
        run_id: str | None = None,
        text_positions: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Process a figure and save results to output directory.

        Creates:
            - {element_id}.json - Full processing results
            - {element_id}.annotated.png - Annotated image (if SAM3 available)

        Args:
            image_path: Path to the original figure image
            output_dir: Directory to save results
            element_id: Unique identifier for the figure element
            ocr_text: OCR text from the figure
            run_id: Optional run identifier
            text_positions: Text position data for SAM3 annotations

        Returns:
            Processing results dict with added 'output_paths' key
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        result = self.process_figure(
            image_path, ocr_text, run_id=run_id, text_positions=text_positions
        )

        # Save JSON results
        json_path = output_dir / f"{element_id}.json"
        with json_path.open("w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=2)
            fh.write("\n")

        result["output_paths"] = {
            "json": str(json_path),
            "original": str(image_path),
        }

        logger.debug(f"Figure {element_id} processed: type={result.get('figure_type')}")
        return result

    def process_elements_batch(
        self,
        elements: list[dict[str, Any]],
        figures_dir: str | Path,
        *,
        run_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Process all figure elements from an extraction run.

        Args:
            elements: List of element dicts from Azure DI extraction
            figures_dir: Directory containing figure images
            run_id: Optional run identifier

        Returns:
            Updated elements list with figure_processing added to figure elements
        """
        figures_dir = Path(figures_dir)
        processed = []

        for el in elements:
            if el.get("type") != "figure":
                processed.append(el)
                continue

            element_id = el.get("id", "")
            image_filename = el.get("figure_image_filename")

            if not image_filename:
                logger.warning(f"Figure {element_id} has no image filename, skipping")
                processed.append(el)
                continue

            image_path = figures_dir / image_filename
            if not image_path.exists():
                logger.warning(f"Figure image not found: {image_path}")
                processed.append(el)
                continue

            try:
                ocr_text = el.get("content", "") or el.get("text", "")
                result = self.process_and_save(
                    image_path=image_path,
                    output_dir=figures_dir,
                    element_id=element_id,
                    ocr_text=ocr_text,
                    run_id=run_id,
                )
                el["figure_processing"] = {
                    "figure_type": result.get("figure_type"),
                    "confidence": result.get("confidence"),
                    "processed_content": result.get("processed_content"),
                    "description": result.get("description"),
                    "step1_duration_ms": result.get("step1_duration_ms"),
                    "step2_duration_ms": result.get("step2_duration_ms"),
                }
                processed.append(el)
            except Exception as e:
                logger.error(f"Failed to process figure {element_id}: {e}")
                el["figure_processing"] = {"error": str(e)}
                processed.append(el)

        return processed


# Module-level singleton for convenience
_processor: FigureProcessorWrapper | None = None


def get_processor() -> FigureProcessorWrapper:
    """Get or create the module-level FigureProcessorWrapper instance."""
    global _processor
    if _processor is None:
        _processor = FigureProcessorWrapper()
    return _processor
