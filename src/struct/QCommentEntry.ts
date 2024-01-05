/**
 * QZone 댓글 목록
 */
export interface QCommentEntry {
  /**
   * 0
   */
  comm_apply: number,
  /**
   * 총 댓글 수
   */
  comm_cnt: number,
  /**
   * 댓글 목록
   */
  comm_list: {
    /**
     * 베스트 댓글
     */
    best_comments: QCommentData[] | null,
    /**
     * 사이다 댓글
     */
    cider_comments: QCommentData[] | null,
    /**
     * 일반 댓글들
     */
    comments: {
      /**
       * 현재 페이지
       */
      current_page: number,
      /**
       * 댓글 데이터
       */
      data: QCommentData[],
      from: number,
      /**
       * 마지막 페이지
       */
      last_page: number,
      /**
       * 1페이지당 댓글 수
       */
      per_page: number,
      /**
       * 이 댓글의 마지막 댓글 번호
       */
      to: number,
      /**
       * 총 댓글수
       */
      total: number,
    },
    sponsor_comm_list: QCommentData[] | null,
  }
}

/**
 * QZone 댓글 데이터
 */
export interface QCommentData {
  /**
   * 댓글 ID
   */
  id: number,
  /**
   * 댓글 내용
   */
  content: string,
  /**
   * 작성자 이름
   */
  name: string,
  /**
   * 유저 ID
   */
  user_id: string,
  /**
   * 작성자 이름
   */
  user_nick: string,
}