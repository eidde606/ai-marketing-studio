"""Transaction mechanics; application services choose when each operation runs.

This deliberately does not create sessions or automatically commit/roll back.
The request's existing session, identity map and lock lifetime are preserved.
"""
from sqlalchemy.orm import Session


class Transactions:
    def __init__(self, session: Session):
        self._session = session

    def commit(self) -> None:
        self._session.commit()

    def rollback(self) -> None:
        self._session.rollback()

    def refresh(self, entity: object) -> None:
        self._session.refresh(entity)

    def expire_all(self) -> None:
        self._session.expire_all()
