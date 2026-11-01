import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluatePinDrag, handlePinDrag } from '../src/viewport/pin-drag-guard.ts';
import { FakeViewportBridge } from '../src/viewport/FakeViewportBridge.ts';

describe('viewport pin drag policy', () => {
  it('blocks a resolved pin drag, preserves its anchor, and requests a not-allowed cursor', () => {
    const pin = {
      id: 'ann-resolved',
      position: [1, 2, 3] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      status: 'RESOLVED' as const,
      selected: true,
    };

    const decision = evaluatePinDrag(pin, {
      position: [4, 5, 6],
      normal: [1, 0, 0],
    });

    assert.deepEqual(decision, {
      allowed: false,
      cursor: 'not-allowed',
      position: [1, 2, 3],
      normal: [0, 1, 0],
      reasonCode: 'SPATIAL_LOCKED_WHEN_RESOLVED',
    });
    assert.deepEqual(pin.position, [1, 2, 3], 'the source marker must not be mutated');
  });

  it('blocks an archived pin drag with the immutable reason code', () => {
    const pin = {
      id: 'ann-archived',
      position: [1, 2, 3] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      status: 'ARCHIVED' as const,
      selected: false,
    };

    const decision = evaluatePinDrag(pin, {
      position: [4, 5, 6],
      normal: [1, 0, 0],
    });

    assert.deepEqual(decision, {
      allowed: false,
      cursor: 'not-allowed',
      position: [1, 2, 3],
      normal: [0, 1, 0],
      reasonCode: 'ANNOTATION_ARCHIVED_IMMUTABLE',
    });
  });

  it('allows OPEN and IN_PROGRESS pins to move to the candidate anchor', () => {
    for (const status of ['OPEN', 'IN_PROGRESS'] as const) {
      const pin = {
        id: `ann-${status.toLowerCase()}`,
        position: [1, 2, 3] as [number, number, number],
        normal: [0, 1, 0] as [number, number, number],
        status,
        selected: false,
      };
      const candidate = { position: [4, 5, 6] as [number, number, number], normal: [1, 0, 0] as [number, number, number] };

      const decision = evaluatePinDrag(pin, candidate);

      assert.deepEqual(decision, {
        allowed: true,
        cursor: 'grab',
        position: candidate.position,
        normal: candidate.normal,
      });
      assert.deepEqual(pin.position, [1, 2, 3], 'evaluating a drag must not mutate the source marker');
    }
  });

  it('rejects a move with an invalid normal using the shared policy reason code', () => {
    const pin = {
      id: 'ann-open',
      position: [1, 2, 3] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      status: 'OPEN' as const,
      selected: false,
    };

    const decision = evaluatePinDrag(pin, {
      position: [4, 5, 6],
      normal: [2, 0, 0],
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, 'INVALID_UNIT_NORMAL_VECTOR');
    assert.deepEqual(decision.position, [1, 2, 3]);
  });

  it('routes rejected drag attempts to the cursor and rejection effects without moving the pin', () => {
    const pin = {
      id: 'ann-locked',
      position: [1, 2, 3] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      status: 'RESOLVED' as const,
      selected: false,
    };
    const cursors: string[] = [];
    const moved: unknown[][] = [];
    const rejections: unknown[][] = [];

    const decision = handlePinDrag(pin, {
      position: [4, 5, 6],
      normal: [1, 0, 0],
    }, {
      setCursor: (cursor) => cursors.push(cursor),
      applyAnchor: (...args) => moved.push(args),
      onBlocked: (...args) => rejections.push(args),
    });

    assert.equal(decision.allowed, false);
    assert.deepEqual(cursors, ['not-allowed']);
    assert.deepEqual(moved, []);
    assert.deepEqual(rejections, [['ann-locked', 'SPATIAL_LOCKED_WHEN_RESOLVED']]);
  });

  it('applies the candidate anchor only for an allowed drag', () => {
    const pin = {
      id: 'ann-open',
      position: [1, 2, 3] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      status: 'OPEN' as const,
      selected: false,
    };
    const cursors: string[] = [];
    const moved: unknown[][] = [];

    const decision = handlePinDrag(pin, {
      position: [4, 5, 6],
      normal: [1, 0, 0],
    }, {
      setCursor: (cursor) => cursors.push(cursor),
      applyAnchor: (...args) => moved.push(args),
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(cursors, ['grab']);
    assert.deepEqual(moved, [['ann-open', [4, 5, 6], [1, 0, 0]]]);
  });

  it('keeps a resolved marker still through the fake viewport bridge and exposes its lock reason', () => {
    const bridge = new FakeViewportBridge();
    const pin = {
      id: 'ann-resolved-fake',
      position: [1, 2, 3] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      status: 'RESOLVED' as const,
      selected: false,
    };
    bridge.setPins([pin]);

    const decision = bridge.simulatePinDrag('ann-resolved-fake', {
      position: [4, 5, 6],
      normal: [1, 0, 0],
    });

    assert.equal(decision.allowed, false);
    assert.deepEqual(bridge.getRenderedPins(), [pin]);
    assert.equal(bridge.getPinDragCursor(), 'not-allowed');
    assert.deepEqual(bridge.getLastPinDragRejection(), {
      annotationId: 'ann-resolved-fake',
      reasonCode: 'SPATIAL_LOCKED_WHEN_RESOLVED',
    });
  });

  it('updates movable markers through the fake viewport bridge', () => {
    const bridge = new FakeViewportBridge();
    for (const status of ['OPEN', 'IN_PROGRESS'] as const) {
      const pin = {
        id: `ann-${status.toLowerCase()}-fake`,
        position: [1, 2, 3] as [number, number, number],
        normal: [0, 1, 0] as [number, number, number],
        status,
        selected: false,
      };
      bridge.setPins([pin]);

      const decision = bridge.simulatePinDrag(pin.id, {
        position: [4, 5, 6],
        normal: [1, 0, 0],
      });

      assert.equal(decision.allowed, true);
      assert.deepEqual(bridge.getRenderedPins()[0], {
        ...pin,
        position: [4, 5, 6],
        normal: [1, 0, 0],
      });
      assert.equal(bridge.getPinDragCursor(), 'grab');
      assert.equal(bridge.getLastPinDragRejection(), null);
    }
  });
});
