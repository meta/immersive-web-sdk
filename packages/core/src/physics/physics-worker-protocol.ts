/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export const PHYSICS_PROTOCOL_VERSION = 2;

/**
 * The header is deliberately one cache line. Integer fields use an Int32Array
 * view and the delta field uses a Float32Array view over the same buffer.
 */
export const PHYSICS_HEADER_WORDS = 16;
export const PHYSICS_HEADER_BYTES = PHYSICS_HEADER_WORDS * 4;

export const PHYSICS_INPUT_RECORD_FLOATS = 25;
export const PHYSICS_OUTPUT_RECORD_FLOATS = 14;

export const enum PhysicsHeaderIndex {
  Version = 0,
  Sequence = 1,
  CommandCount = 2,
  ResultCount = 3,
  Status = 4,
  StepCount = 5,
  Delta = 8,
}

export const enum PhysicsExchangeStatus {
  Ok = 0,
  ResultsTruncated = 1 << 0,
  StepFailed = 1 << 1,
}

export const enum PhysicsCommandFlag {
  SetTargetTransform = 1 << 0,
  SetTransform = 1 << 1,
  ResetLinearVelocity = 1 << 2,
  ResetAngularVelocity = 1 << 3,
  ApplyImpulse = 1 << 4,
  SetLinearVelocity = 1 << 5,
  SetAngularVelocity = 1 << 6,
  SetGravityFactor = 1 << 7,
  SetLinearDamping = 1 << 8,
  SetAngularDamping = 1 << 9,
  SetKinematicOverride = 1 << 10,
}

export const enum PhysicsInputOffset {
  Handle = 0,
  Flags = 1,
  PositionX = 2,
  PositionY = 3,
  PositionZ = 4,
  QuaternionX = 5,
  QuaternionY = 6,
  QuaternionZ = 7,
  QuaternionW = 8,
  ImpulsePointX = 9,
  ImpulsePointY = 10,
  ImpulsePointZ = 11,
  ImpulseX = 12,
  ImpulseY = 13,
  ImpulseZ = 14,
  LinearVelocityX = 15,
  LinearVelocityY = 16,
  LinearVelocityZ = 17,
  AngularVelocityX = 18,
  AngularVelocityY = 19,
  AngularVelocityZ = 20,
  GravityFactor = 21,
  LinearDamping = 22,
  AngularDamping = 23,
  /** Non-zero drives the body as kinematic; zero restores its created motion type. */
  KinematicOverride = 24,
}

export const enum PhysicsOutputOffset {
  Handle = 0,
  PositionX = 1,
  PositionY = 2,
  PositionZ = 3,
  QuaternionX = 4,
  QuaternionY = 5,
  QuaternionZ = 6,
  QuaternionW = 7,
  LinearVelocityX = 8,
  LinearVelocityY = 9,
  LinearVelocityZ = 10,
  AngularVelocityX = 11,
  AngularVelocityY = 12,
  AngularVelocityZ = 13,
}

export type PhysicsWorkerBodyState = 'STATIC' | 'DYNAMIC' | 'KINEMATIC';
export type PhysicsWorkerShapeType =
  | 'Sphere'
  | 'Box'
  | 'Cylinder'
  | 'Capsules'
  | 'ConvexHull'
  | 'TriMesh';

export interface PhysicsWorkerShapeDescriptor {
  type: PhysicsWorkerShapeType;
  dimensions: [number, number, number];
  density: number;
  restitution: number;
  friction: number;
  vertices?: ArrayBuffer;
  indices?: ArrayBuffer;
}

export interface PhysicsWorkerInitMessage {
  type: 'init';
  gravity: [number, number, number];
}

export interface PhysicsWorkerSetGravityMessage {
  type: 'set-gravity';
  gravity: [number, number, number];
}

export interface PhysicsWorkerAddBodyMessage {
  type: 'add-body';
  handle: number;
  shape: PhysicsWorkerShapeDescriptor;
  state: PhysicsWorkerBodyState;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  linearDamping: number;
  angularDamping: number;
  gravityFactor: number;
  centerOfMass: [number, number, number];
}

export interface PhysicsWorkerRemoveBodyMessage {
  type: 'remove-body';
  handle: number;
}

export interface PhysicsWorkerStepMessage {
  type: 'step';
  buffer: ArrayBuffer;
}

export type PhysicsWorkerInputMessage =
  | PhysicsWorkerInitMessage
  | PhysicsWorkerSetGravityMessage
  | PhysicsWorkerAddBodyMessage
  | PhysicsWorkerRemoveBodyMessage
  | PhysicsWorkerStepMessage;

export interface PhysicsWorkerReadyMessage {
  type: 'ready';
}

export interface PhysicsWorkerBodyCreatedMessage {
  type: 'body-created';
  handle: number;
  centerOfMass: [number, number, number];
}

export interface PhysicsWorkerStepResultMessage {
  type: 'step-result';
  buffer: ArrayBuffer;
}

export interface PhysicsWorkerErrorMessage {
  type: 'error';
  message: string;
  handle?: number;
}

export type PhysicsWorkerOutputMessage =
  | PhysicsWorkerReadyMessage
  | PhysicsWorkerBodyCreatedMessage
  | PhysicsWorkerStepResultMessage
  | PhysicsWorkerErrorMessage;

export function physicsExchangeByteLength(
  commandCount: number,
  resultCapacity: number,
): number {
  return (
    PHYSICS_HEADER_BYTES +
    Math.max(
      commandCount * PHYSICS_INPUT_RECORD_FLOATS * 4,
      resultCapacity * PHYSICS_OUTPUT_RECORD_FLOATS * 4,
    )
  );
}

export function getCapsuleAxisEndpoints(
  radius: number,
  totalHeight: number,
): [[number, number, number], [number, number, number]] | null {
  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(totalHeight) ||
    radius <= 0 ||
    totalHeight < radius * 2
  ) {
    return null;
  }
  const halfSegment = totalHeight / 2 - radius;
  if (halfSegment === 0) {
    return [
      [0, 0, 0],
      [0, 0, 0],
    ];
  }
  return [
    [0, -halfSegment, 0],
    [0, halfSegment, 0],
  ];
}
