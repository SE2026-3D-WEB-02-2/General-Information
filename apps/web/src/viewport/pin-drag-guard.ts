import {
  evaluateAnnotationMutation,
  type PolicyReasonCode,
  type Vec3,
  type ViewportPinMarker,
} from '@spriter/shared';

export interface PinDragDecision {
  allowed: boolean;
  cursor: 'grab' | 'not-allowed';
  position: Vec3;
  normal: Vec3;
  reasonCode?: PolicyReasonCode;
}

/**
 * Evaluate a proposed 3D pin drag using the shared annotation policy.
 * Rejected drags return the original anchor so the viewport can leave the pin in place.
 */
export function evaluatePinDrag(
  pin: ViewportPinMarker,
  candidate: Pick<ViewportPinMarker, 'position' | 'normal'>,
): PinDragDecision {
  const check = evaluateAnnotationMutation(
    {
      status: pin.status,
      comments: [],
      position: pin.position,
      normal: pin.normal,
    },
    {
      position: candidate.position,
      normal: candidate.normal,
    },
  );

  if (!check.allowed) {
    return {
      allowed: false,
      cursor: 'not-allowed',
      position: cloneVec3(pin.position),
      normal: cloneVec3(pin.normal),
      ...(check.reasonCode ? { reasonCode: check.reasonCode } : {}),
    };
  }

  return {
    allowed: true,
    cursor: 'grab',
    position: cloneVec3(candidate.position),
    normal: cloneVec3(candidate.normal),
  };
}

export interface PinDragEffects {
  /** Apply the accepted spatial anchor to the viewport model. */
  applyAnchor(annotationId: string, position: Vec3, normal: Vec3): void;
  /** Apply the cursor style for this drag attempt. */
  setCursor(cursor: PinDragDecision['cursor']): void;
  /** Surface a shared-policy rejection to the viewport/UI when needed. */
  onBlocked?(annotationId: string, reasonCode: PolicyReasonCode): void;
}

/**
 * Handle a pin drag attempt at the viewport boundary. Only accepted decisions
 * reach applyAnchor; blocked decisions retain the marker's original anchor.
 */
export function handlePinDrag(
  pin: ViewportPinMarker,
  candidate: Pick<ViewportPinMarker, 'position' | 'normal'>,
  effects: PinDragEffects,
): PinDragDecision {
  const decision = evaluatePinDrag(pin, candidate);
  effects.setCursor(decision.cursor);

  if (decision.allowed) {
    effects.applyAnchor(pin.id, decision.position, decision.normal);
  } else if (decision.reasonCode) {
    effects.onBlocked?.(pin.id, decision.reasonCode);
  }

  return decision;
}

function cloneVec3([x, y, z]: Vec3): Vec3 {
  return [x, y, z];
}
